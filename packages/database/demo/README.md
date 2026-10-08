# AI-generated demo photography

All 42 item and portrait assets were generated with OpenAI's built-in image generation tool on 2026-10-08. They replace the former stock photographs. `sources.json` records each prompt and the SHA-256 fingerprint of its final JPEG; it also records the generated café hero in `apps/web/src/assets/cafe.jpg`. No external image download is needed when seeding.

Objects are unbranded and portraits depict invented adults. These images illustrate fictional profiles and listings, not real people, ownership, endorsements or available inventory. Selected bundles show their included objects: camera and lens, book collection, plant pair, and stationery set. The ordinary seed uploads through Express/Sharp, re-encodes as WebP, and uses the same bundled files in development and production.

Existing seeds skip completed uploads. Use the explicit media refresh in `context/DEMO.md` to replace their images. `previous-media.json` contains fingerprints of the previous seed's processed image bytes, allowing the refresh to reject subsequently edited media. It contains no credentials or personal data.

Private credentials, journals, backups and refresh receipts remain in the ignored `.demo.local/` and `.demo.hosted.local/` directories. Never publish them or include them in browser assets.
