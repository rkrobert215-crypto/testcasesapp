import assert from 'node:assert/strict';
import test from 'node:test';
import { fitImagesWithinCloudPayloadBudget } from '../src/lib/imageOptimizer.ts';

test('image payload budget keeps accepted screenshots below the cloud request ceiling', () => {
  const candidates = [
    'a'.repeat(1_500_000),
    'b'.repeat(1_500_000),
    'c'.repeat(1_500_000),
  ];

  const result = fitImagesWithinCloudPayloadBudget([], candidates);

  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejectedCount, 1);
  assert.ok(result.accepted.reduce((total, image) => total + image.length, 0) <= 3_800_000);
});

test('image payload budget accounts for screenshots already attached', () => {
  const result = fitImagesWithinCloudPayloadBudget(
    ['a'.repeat(3_400_000)],
    ['b'.repeat(300_000), 'c'.repeat(200_000)]
  );

  assert.deepEqual(result.accepted.map((value) => value[0]), ['b']);
  assert.equal(result.rejectedCount, 1);
});
