import { hasConfig, loadConfig } from './ConfigUtils.js';
import { OcrPlayer } from './OcrPlayer.js';
import VideoFileCaptureDriver from './VideoFileCaptureDriver.js';

const refs = {
	file: document.getElementById('video_file'),
	speed: document.getElementById('parse_speed'),
	parse: document.getElementById('parse_video'),
	abort: document.getElementById('abort_video'),
	status: document.getElementById('ingest_status'),
	meta: document.getElementById('video_meta'),
	videoMount: document.getElementById('video_mount'),
	progress: document.getElementById('ingest_progress'),
	progressLabel: document.getElementById('progress_label'),
	frameData: document.getElementById('frame_data'),
	result: document.getElementById('ingest_result'),
	resultLinks: document.getElementById('result_links'),
	configWarning: document.getElementById('config_warning'),
};

let selectedFile = null;
let driver = null;
let player = null;
let finished = false;
let finishTimeout = null;
let lastDriverFrame = null;

function setStatus(message, type = 'info') {
	refs.status.textContent = message;
	refs.status.className = `notification is-${type}`;
	refs.status.hidden = false;
}

function setIdleState() {
	refs.parse.disabled = !selectedFile || !hasConfig();
	refs.abort.disabled = true;
}

function once(target, eventName) {
	return new Promise(resolve => {
		target.addEventListener(eventName, resolve, { once: true });
	});
}

function formatBytes(bytes) {
	if (!bytes) return '0 B';

	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unitIdx = 0;

	while (value >= 1024 && unitIdx < units.length - 1) {
		value /= 1024;
		unitIdx += 1;
	}

	return `${value.toFixed(unitIdx ? 1 : 0)} ${units[unitIdx]}`;
}

function getParseSpeed() {
	const speed = Number(refs.speed.value);
	return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function showFrameData(data) {
	if (!data) return;

	const entries = {
		score: data.score,
		level: data.level,
		lines: data.lines,
		preview: data.preview,
		gameid: data.gameid,
		blocks: data.field?.reduce((acc, cell) => acc + (cell ? 1 : 0), 0),
	};

	for (const [name, value] of Object.entries(entries)) {
		let dt = refs.frameData.querySelector(`dt[data-name="${name}"]`);
		let dd;

		if (dt) {
			dd = dt.nextElementSibling;
		} else {
			dt = document.createElement('dt');
			dd = document.createElement('dd');
			dt.dataset.name = name;
			dt.textContent = name;
			refs.frameData.append(dt, dd);
		}

		dd.textContent = value ?? '-';
	}
}

function updateProgress() {
	const video = driver?.getVideo();

	if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
		refs.progress.value = 0;
		refs.progressLabel.textContent = '';
		return;
	}

	const percent = Math.min(100, (100 * video.currentTime) / video.duration);
	const speed = driver?.getPlaybackRate?.() ?? getParseSpeed();
	const perf = lastDriverFrame
		? ` - ${lastDriverFrame.elapsed.toFixed(0)}ms OCR, ${lastDriverFrame.skipped} skipped`
		: '';

	refs.progress.value = percent;
	refs.progressLabel.textContent = `${Math.floor(video.currentTime)}s / ${Math.floor(video.duration)}s @ ${speed}x${perf}`;
}

function showScoreRecorded(scoreId) {
	finished = true;
	clearTimeout(finishTimeout);

	refs.result.hidden = false;
	refs.resultLinks.replaceChildren();

	const links = [
		['Score list', '/stats/scores'],
		['Details', `/stats/scores/${scoreId}`],
		['Replay', `/replay/classic/${scoreId}`],
	];

	for (const [label, href] of links) {
		const a = document.createElement('a');
		a.className = 'button is-link is-light';
		a.href = href;
		a.textContent = label;
		refs.resultLinks.append(a);
	}

	setStatus(`Recorded score ${scoreId}.`, 'success');
	refs.abort.disabled = true;
	driver?.pause();
	player?.closeConnection();
	setIdleState();
}

function cleanup({ keepVideo = false } = {}) {
	clearTimeout(finishTimeout);
	finishTimeout = null;

	try {
		player?.closeConnection();
	} catch (_err) {}

	try {
		driver?.destroy();
	} catch (_err) {}

	player = null;
	driver = null;
	finished = false;
	lastDriverFrame = null;

	if (!keepVideo) {
		refs.videoMount.replaceChildren();
	}

	setIdleState();
}

async function finishGame() {
	if (finished) return;

	setStatus('Finalizing game record...', 'warning');
	player?.sendCommand('finishGame');

	finishTimeout = setTimeout(() => {
		if (finished) return;

		setStatus(
			'No score was recorded. The video may not have produced enough valid game frames.',
			'danger'
		);
		refs.abort.disabled = false;
	}, 10000);
}

async function startIngest() {
	if (!selectedFile) return;

	cleanup();

	if (!hasConfig()) {
		setStatus('OCR calibration is missing.', 'danger');
		return;
	}

	refs.parse.disabled = true;
	refs.abort.disabled = false;
	refs.result.hidden = true;
	refs.resultLinks.replaceChildren();
	refs.frameData.replaceChildren();
	refs.progress.value = 0;
	refs.progressLabel.textContent = '';

	setStatus('Loading OCR config...', 'info');

	const config = await loadConfig();

	if (config.mode === 'multiviewer') {
		throw new Error('Video ingest supports single-player OCR configs only.');
	}

	driver = new VideoFileCaptureDriver(config);
	driver.setPlaybackRate(getParseSpeed());

	setStatus('Loading video...', 'info');
	await driver.load(selectedFile);

	refs.videoMount.replaceChildren(driver.getVideo());

	player = new OcrPlayer(config, null, {
		connectionPath: '/ws/room/producer',
		enablePeer: false,
		remoteCalibration: false,
		getFrameCTime: () => driver.getCurrentTimeMs(),
	});

	const readyPromise = once(player, 'ready');
	const connectionPromise = once(player, 'connection_init');

	driver.addPlayer(player);
	driver.addEventListener('frame', event => {
		lastDriverFrame = event.detail;
		updateProgress();
	});
	driver.addEventListener('ended', finishGame);
	driver.getVideo().addEventListener('timeupdate', updateProgress);
	player.gameTracker.addEventListener('frame', ({ detail }) => {
		showFrameData(detail);
	});
	player.addEventListener('score_recorded', ({ detail }) => {
		showScoreRecorded(detail.scoreId);
	});

	setStatus('Preparing OCR...', 'info');
	await readyPromise;

	setStatus('Connecting producer socket...', 'info');
	await connectionPromise;

	setStatus(`Parsing video at ${driver.getPlaybackRate()}x...`, 'info');
	await driver.start();
}

refs.file.addEventListener('change', () => {
	selectedFile = refs.file.files?.[0] || null;

	if (selectedFile) {
		refs.meta.textContent = `${selectedFile.name} - ${selectedFile.type || 'video'} - ${formatBytes(selectedFile.size)}`;
	} else {
		refs.meta.textContent = '';
	}

	setIdleState();
});

refs.parse.addEventListener('click', () => {
	startIngest().catch(err => {
		console.error(err);
		setStatus(err.message || 'Unable to parse video.', 'danger');
		cleanup({ keepVideo: true });
	});
});

refs.speed.addEventListener('change', () => {
	driver?.setPlaybackRate(getParseSpeed());
	updateProgress();
});

refs.abort.addEventListener('click', () => {
	player?.sendCommand('abortGame');
	cleanup();
	setStatus('Parsing aborted.', 'warning');
});

if (hasConfig()) {
	refs.configWarning.hidden = true;
	setStatus('Ready.', 'info');
} else {
	refs.configWarning.hidden = false;
	setStatus('OCR calibration is required before parsing a video.', 'warning');
}

setIdleState();
