// Stack-validation smoke step definitions for ADR 0007 — throwaway scaffolding.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

interface SmokeWorld {
  ran?: boolean;
  result?: string;
}

Given('I run a smoke test', function (this: SmokeWorld) {
  this.ran = true;
});

When('I run cucumber', function (this: SmokeWorld) {
  assert.equal(this.ran, true);
  this.result = 'ok';
});

Then('it passes', function (this: SmokeWorld) {
  assert.equal(this.result, 'ok');
});
