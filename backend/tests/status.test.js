// tests/status.test.js - unit tests for the time/status logic in attendance controller
'use strict';

const { internal } = require('../src/controllers/attendance.controller');

const { statusForCheckIn, statusForCheckOut } = internal;

function mockNow(h, m) {
    const d = new Date('2024-01-15T00:00:00Z');
    d.setUTCHours(h);
    d.setUTCMinutes(m);
    return d;
}

describe('statusForCheckIn', () => {
    test('on_time when exactly at WORK_START', () => {
        expect(statusForCheckIn(mockNow(1, 30), '2024-01-15')).toBe('on_time');  // 01:30 UTC = 08:30 VN
    });
    test('on_time when within grace', () => {
        expect(statusForCheckIn(mockNow(1, 35), '2024-01-15')).toBe('on_time');  // 08:35 VN
    });
    test('late after grace', () => {
        expect(statusForCheckIn(mockNow(2, 0), '2024-01-15')).toBe('late');  // 09:00 VN
    });
});

describe('statusForCheckOut', () => {
    test('on_time at WORK_END', () => {
        expect(statusForCheckOut(mockNow(10, 30))).toBe('on_time');  // 17:30 VN
    });
    test('on_time within grace window', () => {
        expect(statusForCheckOut(mockNow(10, 25))).toBe('on_time');  // 17:25 VN
    });
    test('early_leave when too early', () => {
        expect(statusForCheckOut(mockNow(9, 0))).toBe('early_leave');  // 16:00 VN
    });
});
