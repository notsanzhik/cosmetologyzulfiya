import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPhone, translations } from "../src/shared";

test("phone paste accepts local, international and trunk prefixes without dropping a mobile digit", () => {
  for (const input of ["7013528485", "+77013528485", "77013528485", "87013528485", "8 (701) 352-84-85"])
    assert.equal(maskPhone(input), "+7 (701) 352-84-85", input);
});

test("phone formatting allows typing and deleting through the area code", () => {
  let input = "+7";
  for (const digit of "7013528485") input = maskPhone(input + digit);
  assert.equal(input, "+7 (701) 352-84-85");
  for (let count = 0; count < 10; count++) {
    const previousDigits = input.replace(/\D/g, "");
    input = maskPhone(input.slice(0, -1));
    assert.equal(input.replace(/\D/g, ""), previousDigits.slice(0, -1));
  }
  assert.equal(input, "+7");
  assert.equal(maskPhone(""), "+7");
});

test("every Russian interface key has a Kazakh translation including error states", () => {
  const paths = (value: object, prefix = ""): string[] => Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? paths(item, `${prefix}${key}.`) : [`${prefix}${key}`]);
  assert.deepEqual(paths(translations.kk).sort(), paths(translations.ru).sort());
});
