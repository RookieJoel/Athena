# DevSecOps Pipeline Learning Notes

## Roadmap

```
Step 1  → Pin action versions (supply chain)        ← current
Step 2  → Least-privilege permissions
Step 3  → Job timeouts
Step 4  → Fix digest race condition (container scan)
Step 5  → SonarQube quality gate blocking
Step 6  → Add test job gate
Step 7  → OWASP SARIF output + gating
Step 8  → npm cache
Step 9  → SBOM generation
Step 10 → Image signing (cosign)
Step 11 → CodeQL (defense-in-depth)
```

---

## Step 1: Pin Action Versions (Supply Chain Security)

### Threat
Using mutable refs (`@main`, `@master`, `@v2`) means your pipeline runs
**whatever code is on that branch/tag right now**. If the action repo is
compromised, attacker code runs inside your pipeline with access to
`GITHUB_TOKEN` and all secrets.

Real incident: `tj-actions/changed-files` was compromised in 2023 — dumped
secrets from thousands of pipelines.

### Rule
**Always pin to commit SHA.** SHAs are immutable; tags and branches are not.

```yaml
# BAD — mutable, unsafe
uses: trufflesecurity/trufflehog@main
uses: aquasecurity/trivy-action@master
uses: dependency-check/Dependency-Check_Action@main

# GOOD — immutable SHA + version comment
uses: trufflesecurity/trufflehog@6da2d9b49af9f55d86054d08a28a2b7f8ded64f7 # v3.88.1
uses: aquasecurity/trivy-action@76071ef0d7ec797419534a183b498b4d6366cf37  # v0.31.0
uses: dependency-check/Dependency-Check_Action@4a4be08be2fc6e459f59c2f6b35c14b6c08d4b7e # v3.2.0
```

### How to find SHAs

```bash
# gh CLI
gh api repos/trufflesecurity/trufflehog/git/ref/tags/v3.88.1 \
  --jq '.object.sha'

# Automate pinning
npm install -g pin-github-action
pin-github-action .github/workflows/ci.yaml
```

### Dependabot — keeps pinned SHAs updated automatically

Without Dependabot: you pin to SHA → forget → action falls 6 versions behind
→ miss security patches. Dependabot watches for new releases and opens PRs
to update the SHA automatically.

```yaml
# .github/dependabot.yml
version: 2
updates:
  # Keep GitHub Actions pinned SHAs current
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      actions:
        patterns: ["*"]

  # Keep npm deps current (frontend + backend)
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"

  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
```

Dependabot PR flow:
```
new action version released
       ↓
Dependabot opens PR: "Bump trufflehog from abc123 to def456"
       ↓
CI runs on that PR (your pipeline validates it)
       ↓
you review + merge
       ↓
pipeline stays current, auditable, secure
```

### Checklist
- [ ] All `@main` / `@master` / `@vX` refs replaced with commit SHAs
- [ ] SHA has version comment so humans know what it is
- [ ] `.github/dependabot.yml` created with `github-actions` ecosystem
- [ ] Dependabot enabled in repo Settings → Code security

---

## Step 2: Least-Privilege Permissions

### Threat
`GITHUB_TOKEN` is auto-issued per workflow run. Setting permissions at
**workflow level** means every job inherits them — including jobs that don't
need them. A compromised action in `secret-scanner` could use `packages: write`
to push malicious images to your registry.

**Principle:** deny all at workflow level, grant per-job only what's needed.

### What each job needs

| Job | contents | packages | security-events |
|---|---|---|---|
| secret-scanner | read | ✗ | ✗ |
| sast-scan | read | ✗ | ✗ |
| dependency-check | read | ✗ | ✗ |
| build | read | **write** | ✗ |
| container-scan | read | ✗ | **write** |

### Fix

```yaml
# workflow level — deny everything by default
permissions: {}

jobs:
  secret-scanner:
    permissions:
      contents: read

  sast-scan:
    permissions:
      contents: read

  dependency-check:
    permissions:
      contents: read

  build:
    permissions:
      contents: read
      packages: write       # push to GHCR

  container-scan:
    permissions:
      contents: read
      security-events: write # upload SARIF to Security tab
```

### Note for Step 10 (image signing)
`build` job will also need `id-token: write` for cosign keyless signing.
Add it only then, only to that job.

### Checklist
- [ ] `permissions: {}` at workflow level
- [ ] Each job has explicit minimal permissions
- [ ] Pipeline still green after change

---

## Step 3: Job Timeouts

### Threat
No timeout = runaway job burns unlimited CI minutes and blocks the queue.
Worse: a hung dependency-download or infinite loop in a scan tool can hold
your `GITHUB_TOKEN` open indefinitely — widening the attack window.

Paid plans bill per minute. A runaway matrix job (2 services × no timeout)
can drain your quota silently.

### Default behavior
GitHub's default timeout is **6 hours**. That's not a safety net — that's
a liability.

### Rule
Set `timeout-minutes` on every job. Match it to realistic worst-case runtime,
not the happy path.

### Recommended timeouts for this pipeline

| Job | Timeout | Reason |
|---|---|---|
| secret-scanner | 10 min | checkout + two scanners, fast |
| sast-scan | 15 min | SonarQube can be slow on large repos |
| dependency-check | 20 min | OWASP NVD download is the bottleneck |
| build | 20 min | Docker build + push, cached layers help |
| container-scan | 10 min | Trivy pulls DB then scans image |

### Fix

```yaml
jobs:
  secret-scanner:
    timeout-minutes: 10

  sast-scan:
    timeout-minutes: 15

  dependency-check:
    timeout-minutes: 20

  build:
    timeout-minutes: 20

  container-scan:
    timeout-minutes: 10
```

### Bonus: workflow-level timeout
Set a ceiling for the entire workflow. Even if individual job timeouts are
misconfigured, nothing runs longer than this:

```yaml
# top of workflow, under `on:`
env:
  ...

# GitHub does NOT support workflow-level timeout-minutes natively.
# Use a job dependency chain so build can't outlive its gates.
# Alternatively enforce via branch protection: "required checks must
# complete within X minutes" (GitHub Enterprise feature).
```

### Checklist
- [ ] `timeout-minutes` on every job
- [ ] Timeouts are realistic (not 2 min, not 60 min by default)
- [ ] Matrix jobs (build, container-scan) each have their own timeout

---

## Step 4: Digest Race Condition Fix

### Threat
Container scan uses `:latest` tag. Between `build` pushing and `container-scan`
pulling, another push can update `:latest` — you scan the wrong image.
A digest (`sha256:...`) is cryptographically bound to exact content and cannot
be reassigned.

### Problem: matrix overwrites outputs
Matrix jobs share one `outputs` block — last writer wins. Both `frontend` and
`backend` write to the same `digest` key; one gets lost.

### Fix: per-service outputs

```yaml
  build:
    outputs:
      frontend-digest: ${{ matrix.service == 'frontend' && steps.push.outputs.digest || '' }}
      backend-digest: ${{ matrix.service == 'backend' && steps.push.outputs.digest || '' }}
```

Reference in container-scan:

```yaml
  container-scan:
    needs: build
    steps:
      - name: Set digest
        id: digest
        run: |
          if [ "${{ matrix.service }}" = "frontend" ]; then
            echo "value=${{ needs.build.outputs.frontend-digest }}" >> $GITHUB_OUTPUT
          else
            echo "value=${{ needs.build.outputs.backend-digest }}" >> $GITHUB_OUTPUT
          fi

      - name: Run Trivy
        with:
          image-ref: ${{ env.IMAGE_NAME }}-${{ matrix.service }}@${{ steps.digest.outputs.value }}
```

### Tag vs Digest

| | `:latest` | `@sha256:...` |
|---|---|---|
| Mutable | yes — dangerous | no |
| Cryptographic guarantee | no | yes |
| Survives concurrent pushes | no | yes |
| Scans what you built | not guaranteed | guaranteed |

### Checklist
- [ ] `build` outputs `frontend-digest` and `backend-digest` separately
- [ ] `container-scan` resolves correct digest per matrix service
- [ ] `image-ref` uses `@sha256:` not `:latest`

---

## Step 5: SonarQube Quality Gate Blocking

### Threat
`sonarqube-scan-action` only **submits** code for analysis — it does not check
the result. SonarQube analysis is async. Action exits 0 regardless of findings.
Pipeline goes green even with critical vulnerabilities.

### Fix: add quality gate check step

```yaml
      - name: SonarQube Scan
        uses: SonarSource/sonarqube-scan-action@v8.0.0
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      - name: SonarQube Quality Gate Check
        uses: SonarSource/sonarqube-quality-gate-action@v1.1.0
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

`sonarqube-quality-gate-action` polls until analysis completes, exits 1 if
gate FAILED → job fails → build blocked (because `build` needs `sast-scan`).

### What is a Quality Gate?
Configurable conditions in SonarQube UI. Default "Sonar way":
- Coverage on new code >= 80%
- Duplicated lines on new code < 3%
- Reliability / Security / Maintainability rating = A
- Security hotspots reviewed = 100%

### sonar-project.properties (required at repo root)

```properties
sonar.projectKey=athena
sonar.projectName=Athena
sonar.sources=frontend/src,backend/src
sonar.exclusions=**/node_modules/**,**/.next/**,**/dist/**,**/build/**
sonar.javascript.lcov.reportPaths=frontend/coverage/lcov.info,backend/coverage/lcov.info
```

### SonarQube vs SonarCloud

| | SonarQube | SonarCloud |
|---|---|---|
| Hosting | self-hosted | SaaS |
| Free for OSS | no | yes |
| `SONAR_HOST_URL` | your server | `https://sonarcloud.io` |

### Checklist
- [ ] `sonarqube-quality-gate-action` added after scan step
- [ ] `SONAR_HOST_URL` secret configured
- [ ] `sonar-project.properties` created at repo root
- [ ] Quality gate conditions configured in SonarQube/SonarCloud UI

---

## Step 6: Test Job Gate

### Threat
No tests before build = broken code gets packaged and pushed to registry.
You scan a broken image for CVEs instead of catching the bug first.

### Pipeline flow (after fix)
```
secret-scanner ─┐
sast-scan       ├──→ test (matrix) ──→ build ──→ container-scan
dependency-check┘
```

### Test job

```yaml
  test:
    name: Test (${{ matrix.service }})
    runs-on: ubuntu-latest
    needs: [secret-scanner, sast-scan, dependency-check]
    timeout-minutes: 15
    permissions:
      contents: read
    strategy:
      matrix:
        service: [frontend, backend]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ${{ matrix.service }}/package-lock.json

      - name: Install dependencies
        run: npm ci --prefix ${{ matrix.service }}

      - name: Run tests
        run: npm test --prefix ${{ matrix.service }} -- --coverage --ci

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.service }}
          path: ${{ matrix.service }}/coverage
          retention-days: 7
```

Update build to require test:
```yaml
  build:
    needs: [test]
```

### Why sequential not parallel
Parallel: tests fail → build still runs → broken image pushed → manual cleanup needed.
Sequential: tests fail → build never runs → registry stays clean.

### Coverage enforcement (jest.config.js)
```js
module.exports = {
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
}
```
Jest exits non-zero below threshold → job fails → build blocked.

### Checklist
- [ ] `test` job added with matrix matching `build`
- [ ] `build` needs `[test]` not the security jobs directly
- [ ] `--coverage --ci` flags on test run
- [ ] Coverage thresholds set in jest config
- [ ] Coverage artifact uploaded for SonarQube (Step 5)

---

## Step 7: OWASP SARIF Output + Gating

### Threat
`format: 'HTML'` = human-readable only. GitHub can't parse it.
Findings don't appear in Security tab. Developers see red job, not which CVE.

SARIF (Static Analysis Results Interchange Format) is the machine-readable
standard GitHub Security tab consumes. Every scanner should emit it.

### What SARIF gives you
- CVE ID, severity, affected package, fix version visible in GitHub UI
- Alerts auto-dismissed when fix merges
- Unified view across all scanners (OWASP + Trivy + CodeQL)

### Fix

```yaml
format: 'HTML,SARIF'    # was: HTML only

- name: Upload SARIF to GitHub Security
  if: always()           # upload even when --failOnCVSS triggers job failure
  uses: github/codeql-action/upload-sarif@... # v4
  with:
    sarif_file: ${{ github.workspace }}/reports/dependency-check-report.sarif
```

`if: always()` is critical — job fails on CVSS ≥ 7, but SARIF must still
upload so the alert appears in Security tab for triage.

### SARIF flow across pipeline
```
dependency-check → SARIF → Security tab (SCA / dependency CVEs)
Trivy            → SARIF → Security tab (container image CVEs)
CodeQL (Step 11) → SARIF → Security tab (code vulnerabilities)
```

### Checklist
- [ ] `format: 'HTML,SARIF'` on OWASP dep-check
- [ ] `upload-sarif` step added with `if: always()`
- [ ] `security-events: write` permission on `dependency-check` job
- [ ] Alerts visible in GitHub → Security → Code scanning

---

## Step 8: npm Cache

### Why
No cache = `npm ci` downloads full dep tree every run. 4 `npm ci` runs per push
(dependency-check + test ×2 matrix). 45–90s each vs 3–8s cached.
Slow pipelines → developers bypass gates.

### Two approaches

**Option A: setup-node built-in** (test job)
```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'npm'
    cache-dependency-path: ${{ matrix.service }}/package-lock.json
```

**Option B: actions/cache manual** (jobs without setup-node)
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ matrix.service }}-${{ hashFiles(format('{0}/package-lock.json', matrix.service)) }}
    restore-keys: |
      npm-${{ matrix.service }}-
      npm-
```

### Cache key strategy
```
key: npm-frontend-abc123    ← exact hit, full restore
restore-keys:
  npm-frontend-             ← partial hit, stale but faster than nothing
  npm-                      ← last resort
```
`hashFiles('**/package-lock.json')` auto-busts on lockfile change.

### Status
Already applied in pipeline rewrite. Both `test` and `dependency-check` jobs cached.

### Checklist
- [ ] `test` job uses `setup-node` with `cache: 'npm'`
- [ ] `dependency-check` job uses `actions/cache` for `~/.npm`
- [ ] Cache keys include `hashFiles` on lockfile

---

## Step 9: SBOM Generation

### What is an SBOM?
Software Bill of Materials — machine-readable inventory of every component
in your image: OS packages, language deps, versions, licenses.

```
image: ghcr.io/you/athena-frontend@sha256:abc123
  ├── debian 12.5
  ├── node 20.11.0
  ├── react 18.2.0
  └── lodash 4.17.21  ← CVE here? SBOM tells you instantly
```

### Why it matters
- Incident response: "which images contain log4j?" → query SBOM, done
- Compliance: US EO 14028, EU Cyber Resilience Act (2027) require SBOMs
- License audit: full inventory per image
- Attestation: proof of what went into each digest

### Formats
- **SPDX** — Linux Foundation standard, broad tooling support
- **CycloneDX** — OWASP standard, richer security metadata

### Fix: add to build job after push

```yaml
      - name: Generate SBOM
        uses: anchore/sbom-action@df80a981bc6edbc4e220a492d3cbe9f5547a6e75 # v0.17.9
        with:
          image: ${{ env.IMAGE_NAME }}-${{ matrix.service }}@${{ steps.push.outputs.digest }}
          format: spdx-json
          output-file: sbom-${{ matrix.service }}.spdx.json
        env:
          SYFT_REGISTRY_AUTH_USERNAME: ${{ github.actor }}
          SYFT_REGISTRY_AUTH_PASSWORD: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@... # v4
        with:
          name: sbom-${{ matrix.service }}
          path: sbom-${{ matrix.service }}.spdx.json
          retention-days: 90  # audit artifact — keep longer than test coverage
```

### Step 10 preview: attach SBOM as image attestation
```bash
cosign attach sbom --sbom sbom.spdx.json \
  ghcr.io/you/athena@sha256:abc123
```
Proves SBOM came from your pipeline, not tampered with.

### Checklist
- [ ] `sbom-action` added after `build-push-action` in build job
- [ ] Uses digest ref not tag
- [ ] SBOM uploaded as artifact with 90-day retention
- [ ] `SYFT_REGISTRY_AUTH_*` env vars set for private registry access

---

## Step 10: Image Signing (cosign)

### Threat
Nothing proves image in registry = image pipeline built. Attacker modifies
image after push → deployment pulls tampered image → no detection.

### How keyless signing works (Sigstore)
No long-lived private keys. Uses GitHub OIDC identity token.

```
pipeline runs
    ↓
GitHub issues OIDC token (proves: this workflow, this repo, this SHA)
    ↓
cosign exchanges token with Fulcio CA → 10-minute signing cert
    ↓
cosign signs image digest → uploads signature to Rekor (public transparency log)
    ↓
anyone can verify: cosign verify → checks Rekor → confirms origin
```

### Required permission (build job only)
```yaml
permissions:
  id-token: write   # request OIDC token from GitHub
```

### Fix: add to build job

```yaml
      - name: Install cosign
        uses: sigstore/cosign-installer@053f9b74638557590800a301da1ba82351507e2c # v3.8.1

      # after build-push-action
      - name: Sign image
        run: |
          cosign sign --yes \
            ${{ env.IMAGE_NAME }}-${{ matrix.service }}@${{ steps.push.outputs.digest }}
        env:
          COSIGN_EXPERIMENTAL: 1
```

### Verify at deploy time
```bash
cosign verify \
  --certificate-identity-regexp="https://github.com/RookieJoel/Athena/.github/workflows/ci.yaml" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/rookiejoel/athena-frontend@sha256:abc123
```
Fails if: image tampered, signature missing, wrong workflow, untrusted issuer.
Add this to deploy job — never deploy unsigned images.

### Checklist
- [ ] `id-token: write` on build job
- [ ] `cosign-installer` step before build
- [ ] `cosign sign --yes` step after push, uses digest not tag
- [ ] `COSIGN_EXPERIMENTAL: 1` env var set
- [ ] Verification command added to deploy job

---

## Step 11: CodeQL (Defense-in-Depth)

### CodeQL vs SonarQube

| | SonarQube | CodeQL |
|---|---|---|
| Made by | SonarSource | GitHub |
| Analysis | Pattern matching + data flow | Semantic analysis via query language |
| Strength | Quality + security breadth | Deep vulnerability detection |
| False positives | Medium | Low — traces full data flow |
| Custom queries | Limited | Full QL language |
| Hosting | Self-hosted/SonarCloud | GitHub-native, free for public repos |

SonarQube: "this function is dangerous."
CodeQL: "tainted user input flows HTTP request → SQL query without sanitization."
Run both — they complement each other.

### How CodeQL works
```
checkout → build CodeQL database (AST + data flow graph)
    ↓
run query suites (security-extended = OWASP Top 10, injection, XSS, SSRF)
    ↓
emit SARIF → GitHub Security tab
    ↓
block PR if alert severity ≥ threshold (repo settings)
```

### Fix: parallel job alongside sast-scan

```yaml
  codeql-scan:
    name: SAST (CodeQL)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      security-events: write
    strategy:
      matrix:
        language: [javascript]
    steps:
      - uses: actions/checkout@... # v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@7c1e4cf0b20d7c1872b26569c00ba908797a59bf # v4
        with:
          languages: ${{ matrix.language }}
          queries: security-extended

      - name: Autobuild
        uses: github/codeql-action/autobuild@7c1e4cf0b20d7c1872b26569c00ba908797a59bf # v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@7c1e4cf0b20d7c1872b26569c00ba908797a59bf # v4
        with:
          category: /language:${{ matrix.language }}
```

`test` job needs updated:
```yaml
needs: [secret-scanner, sast-scan, codeql-scan, dependency-check]
```

### Query suites
- `security-extended` — OWASP Top 10, injection, XSS, SSRF, path traversal
- `security-and-quality` — above + code quality issues (larger, slower)

### Checklist
- [ ] `codeql-scan` job added parallel to `sast-scan`
- [ ] `security-events: write` permission on job
- [ ] `queries: security-extended` set
- [ ] `test` job `needs` includes `codeql-scan`
- [ ] Alerts visible in GitHub → Security → Code scanning
