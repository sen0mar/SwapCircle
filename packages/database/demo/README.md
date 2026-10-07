# Demo photography

Bundled on 2026-10-07 from the individual Unsplash image URLs in `sources.json`, under the [Unsplash license](https://unsplash.com/license). Photography is used as illustrative content for fictional profiles and listings, not as a claim about real people, ownership, endorsements or available inventory. No image network request is required when seeding.

Each listing has a matching cover. Selected bundles also show their included objects: camera and lens, book collection, plant pair, and stationery set. Images are uploaded through the existing Express/Sharp pipeline, re-encoded as WebP, and stored in the local `item-media` bucket. Portraits illustrate synthetic identities; the named members are fictional.

The seed runner and typed content manifest live in `apps/api/scripts/demo/`. Its private credentials, progress journal, readiness marker and lock live in the Git-ignored `packages/database/.demo.local/` directory. Never publish that directory, include it in browser assets, or upload it to a hosted environment.
