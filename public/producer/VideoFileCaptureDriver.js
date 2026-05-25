import { getOcrClass } from './ocrStrategy.js';

export class VideoFileCaptureDriver extends EventTarget {
	#video;
	#objectUrl;
	#captureFrameCallbackId;
	#captureIntervalId;
	#captureDetails;
	#working = false;
	#skippedFrames = 0;
	#playbackRate = 1;

	constructor(config) {
		super();

		this.config = config;
		this.players = [];
		this.#video = document.createElement('video');
		this.#video.controls = true;
		this.#video.muted = true;
		this.#video.playsInline = true;
		this.#video.preload = 'metadata';

		this.#video.addEventListener('ended', () => {
			this.#stopFrameCapture();
			this.dispatchEvent(new Event('ended'));
		});
	}

	addPlayer(player) {
		player._driver = this;
		this.players.push(player);
	}

	getVideo() {
		return this.#video;
	}

	getCurrentTimeMs() {
		return Math.round(this.#video.currentTime * 1000);
	}

	getPlaybackRate() {
		return this.#playbackRate;
	}

	setPlaybackRate(rate) {
		const numericRate = Number(rate);

		this.#playbackRate =
			Number.isFinite(numericRate) && numericRate > 0 ? numericRate : 1;
		this.#video.playbackRate = this.#playbackRate;

		if (this.#captureDetails) {
			this.#captureDetails.playbackRate = this.#playbackRate;
		}
	}

	async load(file) {
		this.destroy();

		this.file = file;
		this.#objectUrl = URL.createObjectURL(file);
		this.#video.src = this.#objectUrl;
		this.#video.playbackRate = this.#playbackRate;

		await new Promise((resolve, reject) => {
			this.#video.addEventListener('loadedmetadata', resolve, { once: true });
			this.#video.addEventListener('error', reject, { once: true });
		});
	}

	async start() {
		if (!this.#video.src) {
			throw new Error('No video file loaded');
		}

		await this.#updateCaptureDetails();
		this.#video.playbackRate = this.#playbackRate;
		await this.#video.play();
		this.#startFrameCapture();
	}

	pause() {
		this.#video.pause();
		this.#stopFrameCapture();
	}

	destroy() {
		this.pause();
		this.players = [];

		if (this.#objectUrl) {
			URL.revokeObjectURL(this.#objectUrl);
			this.#objectUrl = null;
		}

		this.#video.removeAttribute('src');
		this.#video.load();
	}

	async #updateCaptureDetails() {
		this.#captureDetails = {
			device: 'local video file',
			file: this.file?.name || '',
			video: this.#video,
			videoSize: `${this.#video.videoWidth} x ${this.#video.videoHeight}`,
			videoFps: null,
			playbackRate: this.#playbackRate,
			driverMode: 'file-video',
			ocrClass: (await getOcrClass()).name,
		};
	}

	#startFrameCapture() {
		this.#stopFrameCapture();

		if ('requestVideoFrameCallback' in this.#video) {
			const tick = async () => {
				if (this.#video.paused || this.#video.ended) return;

				this.#captureFrameCallbackId =
					this.#video.requestVideoFrameCallback(tick);

				try {
					await this.#work();
				} catch (err) {
					console.warn(err);
				}
			};

			this.#captureFrameCallbackId =
				this.#video.requestVideoFrameCallback(tick);
			return;
		}

		const frameRate = this.config.frame_rate || 30;
		this.#captureIntervalId = setInterval(async () => {
			if (this.#video.paused || this.#video.ended) return;

			try {
				await this.#work();
			} catch (err) {
				console.warn(err);
			}
		}, 1000 / frameRate);
	}

	#stopFrameCapture() {
		if (this.#captureFrameCallbackId) {
			this.#video.cancelVideoFrameCallback(this.#captureFrameCallbackId);
			this.#captureFrameCallbackId = null;
		}

		if (this.#captureIntervalId) {
			clearInterval(this.#captureIntervalId);
			this.#captureIntervalId = null;
		}
	}

	async #work() {
		const now = performance.now();

		if (this.#working) {
			this.#skippedFrames += 1;
			return;
		}

		this.#working = true;

		performance.clearMarks();
		performance.clearMeasures();
		performance.mark('start-file-video-driver');

		const frame = {
			video: this.#video,
		};

		await Promise.allSettled(this.players.map(p => p.processFrame(frame)));

		performance.mark('end-file-video-driver');

		const measure = performance.measure(
			'file-video-driver',
			'start-file-video-driver',
			'end-file-video-driver'
		);

		this.dispatchEvent(
			new CustomEvent('frame', {
				detail: {
					ts: now,
					skipped: this.#skippedFrames,
					elapsed: measure.duration,
					captureDetails: this.#captureDetails,
				},
			})
		);

		this.#skippedFrames = 0;
		this.#working = false;
	}
}

export default VideoFileCaptureDriver;
