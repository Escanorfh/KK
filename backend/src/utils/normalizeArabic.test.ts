import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic } from "./managers.js";

test("normalizeArabic: basic Arabic text", () => {
  assert.equal(normalizeArabic("المخازن"), "المخازن");
});

test("normalizeArabic: alef variants to alef", () => {
  assert.equal(normalizeArabic("أحمد"), "احمد");
  assert.equal(normalizeArabic("إبراهيم"), "ابراهيم");
  assert.equal(normalizeArabic("آمنة"), "امنه");
  assert.equal(normalizeArabic("ٱلله"), "الله");
});

test("normalizeArabic: alef maqsura to ya", () => {
  assert.equal(normalizeArabic("على"), "علي");
});

test("normalizeArabic: ta marbuta to ha", () => {
  assert.equal(normalizeArabic("مدرسة"), "مدرسه");
  assert.equal(normalizeArabic("سيارة"), "سياره");
});

test("normalizeArabic: waw with hamza to waw", () => {
  assert.equal(normalizeArabic("مؤمن"), "مومن");
});

test("normalizeArabic: diacritics removed", () => {
  assert.equal(normalizeArabic("مَدْرَسَةٌ"), "مدرسه");
  assert.equal(normalizeArabic("بِسْمِ"), "بسم");
});

test("normalizeArabic: leading trailing whitespace trimmed", () => {
  assert.equal(normalizeArabic("  المخازن  "), "المخازن");
  assert.equal(normalizeArabic("\tالمخازن\n"), "المخازن");
});

test("normalizeArabic: repeated whitespace collapsed", () => {
  assert.equal(normalizeArabic("المخازن   العامة"), "المخازن العامه");
  assert.equal(normalizeArabic("a  b   c"), "a b c");
});

test("normalizeArabic: Latin case lowered", () => {
  assert.equal(normalizeArabic("Hello World"), "hello world");
  assert.equal(normalizeArabic("ABC"), "abc");
});

test("normalizeArabic: empty string", () => {
  assert.equal(normalizeArabic(""), "");
});

test("normalizeArabic: whitespace-only string", () => {
  assert.equal(normalizeArabic("   "), "");
  assert.equal(normalizeArabic("\t\n"), "");
});

test("normalizeArabic: non-word characters become spaces", () => {
  assert.equal(normalizeArabic("a-b-c"), "a b c");
  assert.equal(normalizeArabic("test@example.com"), "test example com");
});

test("normalizeArabic: two names normalize to same value", () => {
  assert.equal(normalizeArabic("المخازن"), normalizeArabic("المخازن "));
  assert.equal(normalizeArabic("مدرسة"), normalizeArabic("مَدْرَسَة"));
});

test("normalizeArabic: different names stay different", () => {
  assert.notEqual(normalizeArabic("المخازن"), normalizeArabic("الورشة"));
});
