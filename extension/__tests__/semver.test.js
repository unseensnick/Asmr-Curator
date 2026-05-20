// Property tests for compareSemver — the textbook compare-function laws:
// reflexivity, antisymmetry, transitivity. fast-check generates millions of
// version triples; any bug in the comparator surfaces as a falsifying triple
// with a short shrunk counter-example.
//
// `compareSemver` lives in extension/lib/semver.js (extracted from
// background.js so vitest can import it without spinning up the
// service-worker context).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { compareSemver } from "../lib/semver.js";

// Generate a version string shaped like the release-asset filename's
// `\d+\.\d+\.\d+(-[a-z0-9.-]+)?` — same grammar background.js's
// EXT_ASSET_RE accepts. Numbers capped at a few digits so triples shrink
// to readable counter-examples.
const versionArb = fc
    .tuple(
        fc.nat({ max: 99 }),
        fc.nat({ max: 99 }),
        fc.nat({ max: 99 }),
        fc.option(
            fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,12}$/),
            { nil: undefined },
        ),
    )
    .map(([major, minor, patch, pre]) =>
        pre ? `${major}.${minor}.${patch}-${pre}` : `${major}.${minor}.${patch}`,
    );

describe("compareSemver", () => {
    it("is reflexive: cmp(a, a) === 0", () => {
        fc.assert(
            fc.property(versionArb, (a) => {
                expect(compareSemver(a, a)).toBe(0);
            }),
        );
    });

    it("is antisymmetric: sign(cmp(a, b)) === -sign(cmp(b, a))", () => {
        fc.assert(
            fc.property(versionArb, versionArb, (a, b) => {
                expect(Math.sign(compareSemver(a, b))).toBe(
                    -Math.sign(compareSemver(b, a)),
                );
            }),
        );
    });

    it("is transitive: a > b && b > c implies a > c", () => {
        fc.assert(
            fc.property(versionArb, versionArb, versionArb, (a, b, c) => {
                // Sort the triple by the comparator and verify ordering
                // holds end-to-end — equivalent to transitivity but
                // catches the full chain in one assertion.
                const sorted = [a, b, c].sort(compareSemver);
                expect(compareSemver(sorted[0], sorted[1])).toBeLessThanOrEqual(0);
                expect(compareSemver(sorted[1], sorted[2])).toBeLessThanOrEqual(0);
                expect(compareSemver(sorted[0], sorted[2])).toBeLessThanOrEqual(0);
            }),
        );
    });

    it("treats a release as greater than any pre-release on the same triple", () => {
        fc.assert(
            fc.property(
                fc.nat({ max: 99 }),
                fc.nat({ max: 99 }),
                fc.nat({ max: 99 }),
                fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,12}$/),
                (major, minor, patch, pre) => {
                    const release = `${major}.${minor}.${patch}`;
                    const prerelease = `${release}-${pre}`;
                    expect(compareSemver(release, prerelease)).toBeGreaterThan(0);
                },
            ),
        );
    });
});
