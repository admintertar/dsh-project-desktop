# Third-party notices

Original Shell code is governed by the rights-reserved notice in LICENSE.
The material identified below retains its original terms; the Shell notice does
not restrict the rights granted by those third-party licenses.

## Components and adaptations

- DSH Desktop, Anywhere Labs: https://github.com/anywhere-labs/dsh-desktop
- DeepSeek Harness, DeepSeek: https://github.com/deepseek-ai/deepseek-harness
- The companion dsh-plugin-project: its LICENSE and THIRD_PARTY_NOTICES.md are
  preserved in the generated plugin package. It is not covered by a blanket
  MIT grant from this Shell.
- Electron, React, ReactDOM, esbuild, YAML, parser/highlighter packages and other
  installed dependencies retain their own package-level license files.

Exact Desktop, Harness and plugin revisions are recorded in upstream.lock.json;
root development dependency versions are recorded in package-lock.json.

The Shell's renderer capability filtering adapts Desktop's private
electron-shell-generation.ts helpers. Native menu labels and window/lifecycle
integration use the same pinned official Desktop modules. The models composition
adapts Harness ui-settings-models/src/client/index.ts; its page, store, schema,
locale and CSS remain unchanged source imports. The welcome guide composes
official UI primitives, theme styles and LocaleRuntime. The source inventory
and integration boundaries are documented in docs/architecture.md.

Official source snapshots, dependencies and generated bundles are not committed.
The build preserves Desktop's LICENSE in its generated runtime package. Desktop
packaging includes the Shell and plugin rights notices, package-level dependency
licenses, Electron distribution notices, and the pinned Harness UI license under
THIRD_PARTY_LICENSES/Harness.txt.

The packaging workflow follows the pinned Desktop's native-runner CI and locked
dependency preparation. Windows packaging directly imports its unsigned-build
environment policy, Electron Builder traversal policy and PE validators from
scripts/package-win.ts, scripts/electron-builder-environment.ts and
scripts/verify-win-installer.ts; those source files remain unchanged.

## DSH Desktop license

MIT License

Copyright (c) 2026 Anywhere Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## DeepSeek Harness license

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
