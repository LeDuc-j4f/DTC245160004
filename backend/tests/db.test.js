// tests/db.test.js - unit tests for toVectorLiteral helper
'use strict';

const { toVectorLiteral } = require('../src/config/db');

describe('toVectorLiteral', () => {
    test('simple array', () => {
        expect(toVectorLiteral([1, 2, 3])).toBe('[1.000000,2.000000,3.000000]');
    });
    test('floats', () => {
        const out = toVectorLiteral([0.1, 0.234, 0.5]);
        expect(out).toBe('[0.100000,0.234000,0.500000]');
    });
    test('empty array', () => {
        expect(toVectorLiteral([])).toBe('[]');
    });
    test('throws on non-array', () => {
        expect(() => toVectorLiteral('foo')).toThrow();
    });
});
