import { parseAiReview } from './aiReview.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testMissingAiReviewDoesNotCrash(): void {
  const parsed = parseAiReview({});
  assert(parsed === null, 'missing ai_review should return null');
}

function testValidAiReviewParses(): void {
  const parsed = parseAiReview({
    ai_review: {
      label: 'medium',
      score: 0.71,
      baselineScore: 0.79,
      igptScore: 0.61,
      rationale: 'Parsed with partial claim details.',
      flags: ['missing_service_date']
    }
  });
  assert(parsed !== null, 'valid ai_review should parse');
  assert(parsed?.label === 'medium', 'label should parse');
  assert(parsed?.score === 0.71, 'score should parse');
}

function main(): void {
  testMissingAiReviewDoesNotCrash();
  testValidAiReviewParses();
  console.log('aiReviewTest ok');
}

main();
