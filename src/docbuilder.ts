// Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'crypto';
import uuidv4 from 'uuid/v4';
import spdxLicenses from 'spdx-license-list/full';

import { LicenseBucket, Package } from './structure';
import OutputRenderer from './outputs/base';
import MetadataSource from './inputs/base';
import SPDXLicenseDictionary from './licenses/spdx';
import LicenseDictionary from './licenses/base';

export default class DocBuilder {
  private buckets = new Map<string, LicenseBucket>();

  constructor(
    private renderer: OutputRenderer<any>,
    private licenseDictionary: LicenseDictionary = new SPDXLicenseDictionary()
  ) {}

  addPackage(pkg: Package) {
    // add an identifier if not present
    if (!pkg.uuid) {
      pkg.uuid = uuidv4();
    }

    // see if it's a known license
    const name = pkg.license;
    const license = name ? this.licenseDictionary.get(name) : undefined;

    // prefer package's license text
    let text = '';
    if (pkg.text != undefined && pkg.text.length > 0) {
      text = pkg.text;
    } else if (name) {
      // no provided license text => use our stored version if we have it
      text = license && license.text ? license.text : name;
    }

    // TODO: dedupe copyright strings from the license text; those should
    // only be in copyright fields. having them in the license text kinda
    // ruins license grouping and adds messy duplication to the output.

    // create a key based on the text (or name, if text is empty)
    const hash = DocBuilder.licenseHash(text);

    // sort unknown licenses at the end (~)
    const prefix = name || '';
    const id =
      license != undefined ? `${prefix}~${hash}` : `~${prefix}~${hash}`;

    // determine tags
    const tags: string[] = license ? license.tags : ['unknown'];

    // create or add to a bucket
    const bucket = this.buckets.get(id) || {
      id,
      name,
      text,
      tags,
      packages: [] as Package[],
    };

    bucket.packages.push(pkg);
    this.buckets.set(id, bucket);
  }

  async read(source: MetadataSource) {
    const packages = await source.listPackages();
    for (const packageId of packages) {
      const pkg = source.getPackage(packageId)!;

      this.addPackage(pkg);
    }
  }

  build() {
    const licenseBuckets = this.finalize();
    return this.renderer.render(licenseBuckets);
  }

  private finalize() {
    // sort buckets by id (name, roughly)
    const sortedBuckets = Array.from(this.buckets.keys())
      .sort()
      .map(id => {
        // sort packages in each bucket
        const bucket = this.buckets.get(id)!;
        bucket.packages.sort((a, b) => a.name.localeCompare(b.name));
        return bucket;
      });
    return sortedBuckets;
  }

  get summary() {
    const usedLicenses: any = {};
    const usedTags: any = {};
    this.buckets.forEach((b, key) => {
      usedLicenses[key] = {
        packages: b.packages.map(p => [p.name, p.version]),
        tags: b.tags,
      };
      for (const t of b.tags) {
        const partialTags = usedTags[t] || [];
        partialTags.push(key);
        usedTags[t] = partialTags;
      }
    });

    return {
      usedLicenses,
      usedTags,
    };
  }

  /**
   * Given a license's text, normalize it and create a hash for de-duping.
   */
  static licenseHash(text: string) {
    const hash = createHash('sha256');

    // we *don't* care about spacing/formatting, but we *do* care about text.
    // so just strip out all whitespace/punctuation/specials for the digest.
    text = text.toLowerCase().replace(/\W+/gu, '');

    hash.update(text);
    return hash.digest('hex');
  }
}
