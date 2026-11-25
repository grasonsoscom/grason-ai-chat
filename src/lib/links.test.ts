import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinks, foreignLinks, isAllowedLink, linkHost } from "./links";

test("the official Shopee link is the only link the AI may answer", () => {
  assert.equal(isAllowedLink("https://vivagoat.com/shopee"), true);
  assert.equal(isAllowedLink("https://www.vivagoat.com/shopee"), true);
  assert.equal(isAllowedLink("vivagoat.com/shopee"), true);
  assert.equal(isAllowedLink("https://vivagoat.com/shopee/vivagoat-official"), true);
  assert.equal(isAllowedLink("https://vivagoat.com/"), true);
});

test("another domain, another vivagoat.com path and a shortener are foreign", () => {
  assert.equal(isAllowedLink("https://shopee.co.id/vivagoat"), false);
  assert.equal(isAllowedLink("https://bit.ly/abc"), false);
  assert.equal(isAllowedLink("https://vivagoat.com/produk"), false);
  assert.equal(isAllowedLink("https://vivagoat.com.evil.test/shopee"), false);
  assert.deepEqual(foreignLinks("kak ini linknya https://bit.ly/3xYz"), ["https://bit.ly/3xYz"]);
});

test("wa.me, t.me and uppercase schemes are caught", () => {
  assert.deepEqual(foreignLinks("chat aku ya wa.me/6281234567890"), ["wa.me/6281234567890"]);
  assert.deepEqual(foreignLinks("join t.me/grupnya"), ["t.me/grupnya"]);
  assert.deepEqual(foreignLinks("cek HTTPS://BIT.LY/ABC"), ["HTTPS://BIT.LY/ABC"]);
});

test("text without a link keeps the AI answering", () => {
  assert.deepEqual(extractLinks("sore kak, stok vivagoat ada?"), []);
  assert.deepEqual(foreignLinks("harganya 42.000 ya kak"), []);
  assert.deepEqual(foreignLinks("produknya bagus.banget"), []);
  assert.deepEqual(foreignLinks("nomor aku 0812.3456.7890"), []);
  assert.deepEqual(foreignLinks(""), []);
});

test("a foreign link next to the official one still turns the AI off", () => {
  const text = "order di https://vivagoat.com/shopee atau mampir https://tokopedia.com/toko-kami dulu";
  assert.deepEqual(foreignLinks(text), ["https://tokopedia.com/toko-kami"]);
  assert.deepEqual(foreignLinks("order di https://vivagoat.com/shopee aja kak"), []);
});

test("trailing punctuation and duplicates do not leak into the stored note", () => {
  assert.deepEqual(extractLinks("cek https://bit.ly/abc."), ["https://bit.ly/abc"]);
  assert.deepEqual(extractLinks("cek https://bit.ly/abc!!"), ["https://bit.ly/abc"]);
  assert.deepEqual(extractLinks("https://bit.ly/abc dan https://bit.ly/abc"), ["https://bit.ly/abc"]);
});

test("linkHost strips www and trailing dot", () => {
  assert.equal(linkHost("https://www.vivagoat.com/shopee"), "vivagoat.com");
  assert.equal(linkHost("bukan link"), null);
});
