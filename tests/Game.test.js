import { jest } from '@jest/globals';
import BinaryFrame from '../public/js/BinaryFrame.js';

jest.unstable_mockModule('../modules/config.js', () => ({
	default: {
		get(key) {
			if (key === 'game.save_frames') return false;
			if (key === 'server.is_public') return false;
			return '';
		},
	},
}));

jest.unstable_mockModule('../daos/ScoreDAO.js', () => ({
	default: {
		recordGame: jest.fn(),
	},
}));

const { default: Game } = await import('../modules/Game.js');

function createFrame(overrides = {}) {
	return BinaryFrame.encode({
		game_type: BinaryFrame.GAME_TYPE.CLASSIC,
		gameid: 1,
		ctime: 1000,
		lines: 0,
		level: 18,
		score: 0,
		instant_das: 0,
		preview: 'T',
		cur_piece_das: 0,
		cur_piece: 'T',
		T: 0,
		J: 0,
		Z: 0,
		O: 0,
		S: 0,
		L: 0,
		I: 0,
		field: Array(200).fill(0),
		...overrides,
	});
}

describe('Game', () => {
	it('uses frame ctime for report duration when available', () => {
		const game = new Game(
			{
				id: 1,
				login: 'tester',
				send: jest.fn(),
			},
			{}
		);

		game.setFrame(createFrame({ ctime: 1000 }));
		game.setFrame(createFrame({ ctime: 61000 }));

		expect(game.getReport().duration).toBe(60000);
	});
});
