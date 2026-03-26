import {
  buildCaptureLabel,
  buildDisplayDescription,
  normalizeCaptureKey,
  stripGeneratedMemoFragments
} from './descriptionFormatter.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testCaptureKeyFormatting(): void {
  assert(normalizeCaptureKey('Durham Orthodontics Approved Payment') === 'durham_orthodontics_approved_payment', 'capture key should normalize');
  assert(buildCaptureLabel('email_1') === 'via email_1', 'capture label should be prefixed');
}

function testDisplayDescription(): void {
  assert(
    buildDisplayDescription('Durham Orthodontics Ajax (ROD)', 'email_1') ===
      'Durham Orthodontics Ajax (ROD) (via email_1)',
    'display description should append compact capture suffix'
  );
}

function testMemoCleanup(): void {
  const cleaned = stripGeneratedMemoFragments(
    'Invoice from email | transaction_id=011225O3B-1B7C02C5 | Orthodontics: invoice received via email. Plan: WSIB(ML) 50%',
    [/^invoice from email$/i, /^transaction_id=/i, /^orthodontics: invoice received via email/i]
  );
  assert(cleaned === null, 'fully generated memo fragments should be removable');
}

function main(): void {
  testCaptureKeyFormatting();
  testDisplayDescription();
  testMemoCleanup();
  console.log('descriptionFormatterTest ok');
}

main();
