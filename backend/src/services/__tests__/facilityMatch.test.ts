/**
 * Tests for the facility near-duplicate detector.
 *
 * Pins QA Phase 4 #7 — "Sunrise Medical Center" vs "Sunrise Medical
 * Ctr" must be flagged as near-duplicate, and the detector must not
 * over-trigger on legitimately-different facilities ("Mercy Hospital"
 * vs "Bercy Hospital" is a real different facility, not a typo).
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  normalizeFacilityName,
  levenshtein,
  isNearDuplicateName,
  findNearDuplicates,
} from '../facilityMatch';

describe('normalizeFacilityName', () => {
  test('lowercases and trims', () => {
    assert.equal(normalizeFacilityName('  Sunrise Hospital  '), 'sunrise');
  });

  test('strips punctuation', () => {
    assert.equal(normalizeFacilityName("St. Mary's Medical Center, Inc."), 'st marys');
  });

  test('strips common trailing suffixes', () => {
    assert.equal(normalizeFacilityName('Sunrise Medical Center'), 'sunrise');
    assert.equal(normalizeFacilityName('Sunrise Medical Ctr'), 'sunrise');
  });

  test('does not strip down to empty (preserves single-token names)', () => {
    // "Hospital" alone shouldn't normalize to "".
    assert.equal(normalizeFacilityName('Hospital'), 'hospital');
  });

  test('collapses repeated whitespace', () => {
    assert.equal(normalizeFacilityName('Mercy   General    Hospital'), 'mercy general');
  });

  test('Sunrise Medical Center and Sunrise Medical Ctr normalize equal', () => {
    // The QA-reported pair.
    assert.equal(
      normalizeFacilityName('Sunrise Medical Center'),
      normalizeFacilityName('Sunrise Medical Ctr'),
    );
  });

  test('handles empty input', () => {
    assert.equal(normalizeFacilityName(''), '');
    assert.equal(normalizeFacilityName('   '), '');
  });
});

describe('levenshtein', () => {
  test('identical strings = 0', () => {
    assert.equal(levenshtein('mercy', 'mercy'), 0);
  });
  test('one-char diff = 1', () => {
    assert.equal(levenshtein('mercy', 'merci'), 1);
  });
  test('empty vs string = string length', () => {
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
  });
  test('completely different short strings', () => {
    assert.equal(levenshtein('mercy', 'bercy'), 1);
    assert.equal(levenshtein('mercy', 'macy'), 2);
  });
});

describe('isNearDuplicateName', () => {
  test('Sunrise Medical Center ≈ Sunrise Medical Ctr (the QA case)', () => {
    assert.equal(isNearDuplicateName('Sunrise Medical Center', 'Sunrise Medical Ctr'), true);
  });

  test('case-insensitive', () => {
    assert.equal(isNearDuplicateName('SUNRISE MEDICAL CENTER', 'sunrise medical ctr'), true);
  });

  test('punctuation-insensitive', () => {
    assert.equal(isNearDuplicateName("St. Mary's Hospital", 'St Marys Hospital'), true);
  });

  test('typo within proportional threshold', () => {
    // "Sunrise" vs "Sumrise" — single-char typo, Levenshtein 1, threshold ≥ 2.
    assert.equal(isNearDuplicateName('Sunrise Medical', 'Sumrise Medical'), true);
  });

  test('completely different names do not match', () => {
    // "mercy" vs "bercy" — single char diff but normalized name is short
    // enough that the threshold protects against false positives.
    assert.equal(isNearDuplicateName('Mercy Hospital', 'Bercy Hospital'), false);
  });

  test('subset names do not match (Mercy General ≠ Mercy)', () => {
    // Stripping suffixes might leave different lengths; ensure we don't
    // spuriously match a one-word name against a longer one.
    assert.equal(isNearDuplicateName('Mercy General Hospital', 'Mercy Hospital'), false);
  });

  test('whitespace-only and empty names do not match', () => {
    assert.equal(isNearDuplicateName('', 'Sunrise'), false);
    assert.equal(isNearDuplicateName('Sunrise', ''), false);
    assert.equal(isNearDuplicateName('   ', '   '), false);
  });
});

describe('findNearDuplicates', () => {
  const existing = [
    { id: 'a', name: 'Sunrise Medical Center' },
    { id: 'b', name: 'Mercy Hospital' },
    { id: 'c', name: "St. Vincent's Healthcare" },
    { id: 'd', name: 'Valley Regional Hospital' },
  ];

  test('finds the QA-case duplicate', () => {
    const r = findNearDuplicates('Sunrise Medical Ctr', existing);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'a');
  });

  test('no false positive across unrelated names', () => {
    const r = findNearDuplicates('Lakeshore Surgery Center', existing);
    assert.equal(r.length, 0);
  });

  test('finds typo against existing', () => {
    const r = findNearDuplicates("St Vincents Healthcare", existing);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'c');
  });

  test('returns empty array on empty input', () => {
    const r = findNearDuplicates('', existing);
    assert.equal(r.length, 0);
  });
});
