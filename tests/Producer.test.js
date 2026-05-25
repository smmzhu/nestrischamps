import { jest } from '@jest/globals';
import Producer from '../domains/Producer.js';

describe('Producer control messages', () => {
	function createProducer() {
		return new Producer({
			id: 1,
			login: 'tester',
			vdo_ninja_url: '',
			send: jest.fn(),
		});
	}

	it('finishes the current game without creating a new one', () => {
		const producer = createProducer();
		const game = {
			end: jest.fn(),
			abort: jest.fn(),
		};
		const setGame = jest.spyOn(producer, 'setGame');

		producer.game = game;
		producer._handleMessage(['finishGame']);

		expect(game.end).toHaveBeenCalledTimes(1);
		expect(game.abort).not.toHaveBeenCalled();
		expect(setGame).not.toHaveBeenCalled();
		expect(producer.game).toBeNull();
	});

	it('aborts the current game without ending it', () => {
		const producer = createProducer();
		const game = {
			end: jest.fn(),
			abort: jest.fn(),
		};
		const setGame = jest.spyOn(producer, 'setGame');

		producer.game = game;
		producer._handleMessage(['abortGame']);

		expect(game.abort).toHaveBeenCalledTimes(1);
		expect(game.end).not.toHaveBeenCalled();
		expect(setGame).not.toHaveBeenCalled();
		expect(producer.game).toBeNull();
	});
});
