import { spawn } from 'child_process';

/**
 * VideoToImage helper
 *
 * Usage:
 *   import VideoToImage from '../modules/videotoimage.js';
 *   const v2i = new VideoToImage('/path/to/video.mp4');
 *   const pngBuf = await v2i.ripImage(10); // returns Buffer of PNG data (frame index 10, 0-based)
 *
 * Notes:
 * - This calls an `ffmpeg` binary. It will try to use `ffmpeg-static` if present,
 *   otherwise it expects `ffmpeg` to be available on PATH.
 */
class VideoToImage {
	constructor(videoPath, opts = {}) {
		this.videoPath = videoPath;
		this._ffmpegPath = opts.ffmpegPath || null;
	}

	async _resolveFfmpeg() {
		if (this._ffmpegPath) return this._ffmpegPath;

		try {
			// prefer ffmpeg-static if available in project
			// dynamic import so this module doesn't force the dependency
			// on projects that don't have it installed
			const ffmpegStatic = await import('ffmpeg-static');
			this._ffmpegPath = ffmpegStatic.default || ffmpegStatic;
		} catch (_err) {
			// fallback to system ffmpeg in PATH
			this._ffmpegPath = 'ffmpeg';
		}

		return this._ffmpegPath;
	}

	/**
	 * Rip the Nth frame (0-based) from the video and return an image Buffer.
	 * @param {number} n - 0-based frame index to extract
	 * @param {object} [opts]
	 * @param {'png'|'jpg'} [opts.format='png'] - output image format
	 * @param {number} [opts.timeout=30000] - ms timeout for ffmpeg
	 * @returns {Promise<Buffer>} - image buffer
	 */
	async ripImage(n, opts = {}) {
		if (typeof n !== 'number' || n < 0) {
			throw new Error('ripImage: n must be a non-negative integer');
		}

		const format =
			opts.format === 'jpg' || opts.format === 'jpeg' ? 'mjpeg' : 'png';
		const timeout = typeof opts.timeout === 'number' ? opts.timeout : 30000;

		const ffmpeg = await this._resolveFfmpeg();

		return new Promise((resolve, reject) => {
			// select the exact frame by frame number (0-based)
			// note: need to escape the comma for shell parsing; spawn avoids shell
			const vf = `select=eq(n\\,${n})`;

			const args = [
				'-nostdin',
				'-loglevel',
				'error',
				'-i',
				this.videoPath,
				'-vf',
				vf,
				'-vframes',
				'1',
				'-f',
				'image2pipe',
				'-vcodec',
				format,
				'pipe:1',
			];

			const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

			const chunks = [];
			let stderr = '';

			const killTimer = setTimeout(() => {
				proc.kill('SIGKILL');
				reject(new Error('ffmpeg timed out'));
			}, timeout);

			proc.stdout.on('data', d => chunks.push(d));
			proc.stderr.on('data', d => (stderr += d.toString()));

			proc.on('error', err => {
				clearTimeout(killTimer);
				reject(err);
			});

			proc.on('close', code => {
				clearTimeout(killTimer);

				if (code !== 0 && chunks.length === 0) {
					return reject(new Error(`ffmpeg failed (code ${code}): ${stderr}`));
				}

				resolve(Buffer.concat(chunks));
			});
		});
	}
}

/** Convenience function */
export async function ripNthFrame(videoPath, n, opts = {}) {
	const v = new VideoToImage(videoPath, opts);
	return v.ripImage(n, opts);
}

export default VideoToImage;
