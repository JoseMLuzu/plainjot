# Distribution

## Local archive

Run:

```bash
./scripts/package_release.sh
```

This builds and validates `dist/PlainJot-<version>-macOS.zip`. The current build uses an ad hoc signature, which is appropriate for development but not a polished public download. The script does not create or publish a GitHub Release.

## Signed and notarized release

A public macOS release needs an Apple Developer Program membership, a `Developer ID Application` certificate in Keychain, and notarization credentials stored for `notarytool`.

```bash
xcrun notarytool store-credentials plainjot-notary \
  --apple-id "YOUR_APPLE_ID" \
  --team-id "YOUR_TEAM_ID" \
  --password "YOUR_APP_SPECIFIC_PASSWORD"

codesign --force --deep --options runtime --timestamp \
  --sign "Developer ID Application: YOUR NAME (TEAM_ID)" \
  dist/PlainJot.app

ditto -c -k --keepParent --norsrc \
  dist/PlainJot.app dist/PlainJot-notarization.zip

xcrun notarytool submit dist/PlainJot-notarization.zip \
  --keychain-profile plainjot-notary --wait

xcrun stapler staple dist/PlainJot.app
ditto -c -k --keepParent --norsrc \
  dist/PlainJot.app dist/PlainJot-0.2.0-macOS.zip
```

Do not run `build_macos_app.sh` after signing; rebuilding replaces the signed bundle. Update the archive version to match `CFBundleShortVersionString` before publishing it manually on GitHub Releases.
