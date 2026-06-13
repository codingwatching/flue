# Channel Follow-Ups Roadmap

## Status

The ten-provider first-party channel plan is implemented and audited. This
document records release work, deferred product decisions, and candidate
expansions without reopening the completed ingress design.

Scope decisions confirmed after implementation:

- channel examples prove Node and Cloudflare compatibility; they are not
  turnkey deployment projects and do not own Wrangler migration history;
- provider installation, credentials, webhook registration, and outbound
  behavior are developer-owned application concerns, not future channel-core
  work;
- long-lived transports are unsupported for now; a provider that requires one
  is ineligible until Flue intentionally adds that transport class;
- recurring conformance work should be captured as an agent skill, not a
  repository script.

## Principles

- Preserve the current ownership boundary: Flue owns verified ingress,
  provider identity, protocol responses, and routing; applications own SDK
  clients, credentials, tools, and broad outbound behavior.
- End the first-party channel responsibility at successful HTTP webhook
  receipt and response. App installation and lifecycle management remain
  outside the core even when a provider commonly pairs them with webhooks.
- Require Node and Cloudflare Workers execution for every canonical path.
- Add provider-specific behavior only when official protocol semantics justify
  it. Do not introduce a universal event schema, outbound client, or tool set.
- Do not add a provider whose useful ingress requires a socket, polling loop,
  or other long-lived process under the current channel model.
- Continue using primary provider sources and original synthetic fixtures.

## 1. Release The Completed Channels

This is the immediate next milestone.

- Choose the release version and publish the ten `@flue/*` channel packages
  together with the runtime and CLI changes they require.
- Deploy `apps/www` so the public connector registry serves all ten named
  recipes before announcing `flue add <provider>`.
- Publish the updated documentation and verify every public guide, API page,
  and connector markdown URL.
- Repeat the packed-artifact consumer check against the actual published
  versions.

Release exit criteria:

- every package is installable from the registry;
- every public `flue add` command returns the intended recipe;
- Node and Cloudflare examples build from published artifacts;
- no guide points at an unpublished package or undeployed connector.

The existing missing-Durable-Object-migration warning is not a channel release
blocker. These examples are compatibility and integration fixtures, not
deployment-ready Wrangler projects, and the channel plans never committed to
owning deployment migration history.

## 2. Capture Channel Conformance As An Agent Skill

The final audit required judgment as well as commands, so it should not become
another repository-owned script.

- Add a repository agent skill for researching, implementing, auditing, and
  releasing one first-party HTTP channel.
- Teach the skill to inspect the current provider package and example set
  rather than relying on a hard-coded list.
- Let the skill delegate independent provider research, package review,
  workerd review, docs review, and artifact inspection to subagents when useful.
- Require delegated subagents not to spawn their own subagents.
- Require the implementing agent to reconcile subagent findings and retain
  responsibility for final correctness.
- Include package build, strict types, Node tests, workerd tests, Node and
  Cloudflare example builds, fake outbound transports, packed artifacts, clean
  consumers, connector output, documentation consistency, and focused security
  review.
- Keep provider protocol assertions in provider suites. The skill should
  orchestrate and audit durable public contracts, not duplicate them in a
  generic test harness.

## 3. Core Non-Goals

The following are intentionally outside the first-party channel core:

- app, bot, account, and marketplace installation flows;
- OAuth callbacks, consent, credential encryption, refresh, rotation, and
  revocation;
- tenant or workspace credential lookup;
- webhook registration, renewal, and unregistration;
- broad outbound provider APIs, tools, rich UI builders, uploads, history, and
  search;
- application authorization policy and provider-backed idempotency claims;
- multi-tenant installation orchestration.

Examples and connector guides may explain the minimum configuration needed to
receive a webhook, but Flue should not grow core abstractions for these
application responsibilities. Conversation keys remain identifiers, never
authorization capabilities.

## 4. Expand Existing HTTP Surfaces Only From Concrete Demand

Expand packages only when verified ingress normalization or provider response
semantics require package work. Keep outbound behavior in project-owned
clients and tools.

- Slack: richer HTTP event families and attachment metadata.
- Discord: richer HTTP interaction families and command registration guidance.
- Teams: additional HTTP activity families and file-card metadata that arrives
  directly in verified activity payloads.
- Google Chat: Workspace Events subscription lifecycle, cards, reactions, and
  other verified HTTP event families.
- Linear: broader issue and project events plus agent-activity policy examples.
- Telegram: additional webhook Update families, typing, and media examples.
- WhatsApp: additional incoming message, status, media, Flow callback, and edit
  semantics when Meta documents a stable protocol.
- Twilio: add Messaging webhook families only; treat Voice, Conversations, and
  Verify as separate provider-channel research.
- Messenger: additional incoming webhook families only after concrete demand.

## 5. Research New First-Party Channels

Each candidate starts with the same clean-room provider process. It is eligible
only when its useful inbound integration fits stateless HTTP webhook receipt
and has a defensible Node and Cloudflare Workers path. Defer it immediately if
it requires a long-lived transport, provider-managed process, Node-only
runtime, or installation system inside Flue core.

### Stripe

High priority because the channel API was originally shaped around Stripe's
verified event construction model and Stripe webhooks are common agent
triggers.

- Verify the current Stripe SDK's exact request-byte verification path in
  workerd.
- Support a fixed `/webhook` route with typed `Stripe.Event` delivery if the
  official SDK executes on both targets.
- Keep all Stripe API operations and tools project-owned through the exported
  SDK client.

### Inbound Email / Resend

High priority for support, sales, and operations agents. Vercel's public adapter
directory highlights inbound email through Resend as a useful platform class.

- Research Resend inbound email webhook verification, batching, attachment
  retrieval, retries, and canonical thread identity.
- Prefer the official Fetch-based client if it passes workerd.
- Treat outbound email composition and reply policy as project-owned behavior.

### Notion

- Confirm the current webhook verification, supported event families, retry
  behavior, workspace identity, and resource identity.
- Ship only if useful inbound behavior works with developer-owned OAuth and
  installation state.

### Shopify

- Research webhook HMAC verification, topic and shop identity, retry behavior,
  API versioning, batching, and stable resource identity.
- Keep app installation, access tokens, and outbound Admin API behavior
  developer-owned.

### Intercom

- Research webhook verification, workspace identity, delivery retries, event
  families, and stable conversation or ticket identity.
- Do not take ownership of app installation, OAuth, inbox policy, or outbound
  support operations.

### Zendesk

- Research webhook authenticity, account identity, ticket and conversation
  event semantics, retries, and any provider-required response behavior.
- Defer if a trustworthy inbound path requires a long-lived integration
  service rather than developer-owned setup plus stateless webhooks.

Research these one at a time. A provider being popular is not enough to relax
the HTTP, clean-room, or Cloudflare gates.

### Stripe implementation — 2026-06-13

Status:

- Complete.

Primary sources:

- Stripe webhook, signature, retry, event-destination, Connect, context,
  Checkout fulfillment, Billing webhook, and Issuing authorization docs.
- Official `stripe-node` v22.2.1 research plus the v22.2.0 package metadata,
  source, declarations, and
  Worker exports.
- Current Cloudflare Workers Fetch, Web Crypto, package-condition, and
  workerd-testing documentation.

Clean-room affirmation:

- The design and future fixtures derive from Stripe's primary specifications
  and original synthetic payloads. No third-party adapter implementation,
  types, fixtures, payloads, snapshots, or tests are being copied or
  translated.

Eligibility:

- Eligible for ordinary stateless HTTPS event destinations.
- The official Stripe SDK has explicit `workerd` exports, uses Fetch and Web
  Crypto there, and has no runtime dependencies. Actual workerd execution
  remains required before completion.
- EventBridge, Azure Event Grid, and long-lived transports are outside this
  package.

Design:

- Add `@flue/stripe`, `examples/stripe-channel`, `flue add stripe`, a setup
  guide, and an API reference.
- Publish one fixed `POST /webhook` route.
- Accept the project-owned Stripe SDK `client` because the provider SDK owns
  exact-byte verification, timestamp tolerance, payload-mode validation, and
  native event types.
- Default to snapshot events for the ordinary
  `createStripeChannel({ client, webhookSecret, webhook })` experience.
- Support explicit `eventPayload: 'thin'` for API v2 event notifications.
  Both modes preserve the callback shape `webhook({ c, event })`; their option
  types discriminate `Stripe.Event` from
  `Stripe.V2.Core.EventNotification`.
- Use `constructEventAsync()` and `parseEventNotificationAsync()` so the same
  path executes under Node and Web Crypto runtimes.
- Expose optional signature tolerance and body-limit controls. Do not invent a
  general Stripe handler deadline because Stripe documents no universal
  numeric deadline.
- Preserve normal channel response behavior: no value becomes empty `200`,
  JSON-compatible values become JSON, and ordinary Hono or Fetch responses
  pass through.
- Do not add conversation-key helpers. Stripe has stable event and resource
  identifiers but no universal conversation identity; applications choose a
  customer, subscription, account, checkout session, or other resource key
  appropriate to their workflow.
- Do not add configured account/context restrictions. A destination may
  intentionally aggregate Connect accounts or organization contexts, and the
  signing secret already authenticates the configured destination. Application
  code owns narrower routing policy.

Dependencies and example:

- `@flue/stripe` depends directly on Hono and peers on both `stripe` and
  `@types/node`; Stripe's public declarations reference the latter even on its
  Worker entry. It does not depend on `@flue/runtime`.
- The implementation and example pin aged `stripe@22.2.0` for reproducible
  workspace installs. The newer v22.2.1 patch was less than 24 hours old during
  implementation and changed generated API resources rather than the webhook,
  event-notification, Fetch, Web Crypto, or Worker-export paths used here, so
  the repository's `minimumReleaseAge` policy was preserved.
- The editable example constructs and exports the official Stripe client with
  `Stripe.createFetchHttpClient()`, dispatches completed Checkout events, and
  defines a narrow tool bound to the already-selected customer.
- Workerd tests must execute snapshot and thin verification plus a real
  outbound SDK request against fake Fetch without `nodejs_compat`.

Non-goals:

- Event-destination registration, secret rotation, OAuth, API-key storage,
  deduplication, ordering, replay recovery, and broad outbound tools.
- A universal schema combining snapshot and thin payloads.
- A generic guarantee for synchronous event workflows such as real-time
  Issuing authorization. Applications may return provider responses through
  the normal handler API, but the package and example do not claim that
  specialized latency-sensitive workflow.

Foundation reflection to revisit after implementation:

- Whether accepting a provider SDK for verified ingress remains a clean
  exception to otherwise SDK-free channel packages.
- Whether snapshot and thin modes expose any weakness in the shared callback,
  response, package, example, or workerd conventions.

Implementation:

- Added `@flue/stripe` with one fixed `POST /webhook` route, default snapshot
  events, explicit thin event notifications, exact-byte official SDK
  verification, configurable signature tolerance and body limit, and the
  established Hono-compatible result contract.
- Added original Node and workerd protocol suites. They cover valid and
  tampered bytes, missing, malformed, rotated, and stale signatures, malformed
  JSON and event envelopes, payload-mode mismatches, media type, declared and
  streamed body limits, future snapshot event types, thin notifications with
  and without related objects, handler results, failures, constructor
  validation, and route publication.
- Added `examples/stripe-channel` with a project-owned official Fetch client,
  grouped Checkout completion cases, customer-scoped dispatch, a narrow
  customer-summary tool, trusted Connect or organization context binding,
  Node fake-Fetch coverage, and workerd fake-Fetch coverage.
- Added `flue add stripe`, the Stripe connector recipe, setup and API docs,
  navigation and channel overview entries, README, changelog, and publish
  wiring.

Validation:

- Package build, strict typecheck, 13 Node tests, and two workerd ingress tests
  pass. Workerd executes the official Stripe Worker export, Web Crypto snapshot
  and thin verification, context parsing, and SDK-provided fetch methods
  without `nodejs_compat`.
- Example strict typecheck, Node fake-client test, workerd fake-client test,
  Node build, and Cloudflare target build pass. The workerd test executes a
  real official SDK customer request against fake Fetch and confirms the Node
  HTTP client is unavailable in that runtime.
- A built Node application returned an empty `200` for an original locally
  signed event and `400` for the same exact payload with an invalid signature.
- The focused CLI suite passes, and the real built CLI returned the Stripe
  recipe through the locally built connector registry.
- Documentation typecheck and production build pass; the connector site build
  serves `/cli/connectors/stripe.md`.
- Publish preparation and package packing pass. The tarball contains only the
  intended distribution files, prepared docs, README, license, and manifest.
- A clean strict TypeScript consumer installed only the packed
  `@flue/stripe` package and `stripe`, compiled snapshot and thin handlers with
  a custom Hono environment, and imported the constructor at runtime.
- Credential-pattern and whitespace checks found no leaked provider secret or
  authentication logging. No verification contacted Stripe.

Corrections and deviations:

- Official Stripe declarations showed that valid thin notification families
  can omit `related_object`. The initial runtime guard rejected those
  deliveries, so it now accepts the absent field and coverage protects the
  provider-native behavior.
- The first packed-consumer check exposed that Stripe's Worker declarations
  still reference `@types/node` while Stripe declares that peer optional.
  `@flue/stripe` now declares it as a required peer, and the recipe explains
  the fallback for package managers that do not install peers automatically.
  Keeping it as a peer preserves one consumer-owned Stripe type graph and adds
  no Node runtime code to the Worker bundle.
- One early parallel command raced the example typecheck against a package
  build while `tsdown` replaced `dist`. Ordered package-then-example checks
  pass; this was verification ordering rather than an implementation defect.
- Workerd reports missing upstream Stripe source-map files, and Cloudflare
  builds repeat the existing example Durable Object migration warning. Both
  are non-failing upstream or repository-wide warnings, not Stripe channel
  runtime failures.

Foundation reflection:

- Accepting the provider SDK is a justified local exception: Stripe's official
  implementation owns signature compatibility, Web Crypto selection, native
  event construction, thin context parsing, and fetch helpers, and it executes
  in both required runtimes.
- Snapshot and thin payload modes fit the existing single-object callback,
  fixed-route discovery, and response contract without shared channel changes.
  Their differences remain explicit in one provider-specific discriminated
  constructor option.
- The only repeated machinery was ordinary body limiting and result
  serialization. No new failure scenario justifies extracting another shared
  channel runtime abstraction.
- No Stripe capability is deferred within ordinary stateless HTTPS event
  destinations. EventBridge, Azure Event Grid, registration, secret lifecycle,
  synchronous Issuing policy, deduplication, and outbound API breadth remain
  intentionally outside this channel.

Focused review:

- Independent review found the duplicate Stripe type graph caused by making
  `@types/node` a direct dependency. The final design uses a required
  compatible peer plus repository-only dev pins, and both the example and
  clean packed consumer now resolve one Stripe type instance.
- Review also confirmed that Stripe's generated snapshot and thin unions are
  closed even though the SDK forwards future verified event types. Widening
  the callback would destroy native known-event payload narrowing, so the API,
  guide, recipe, and README document the explicit `event.type as string`
  fallback until the project upgrades Stripe.
- Review found that Stripe rejects requests containing both `stripeAccount`
  and `stripeContext`. The example now prefers the richer verified context and
  falls back to the Connect account only when no context is present. Review
  also found that the initial `@types/node` peer range rejected newer
  compatible declarations; it now matches Stripe's `>=18` compatibility while
  retaining the repository's pinned development version.
- The built Node route has a valid and invalid signed smoke test. Workerd
  separately executes the same Hono ingress route and official verifier, and
  the complete example Worker artifact builds. A second provider assertion
  layer over generated Worker output would duplicate package protocol coverage
  without protecting a distinct contract.
- No unresolved correctness, security, packaging, Cloudflare, or developer
  experience findings remain.

### Notion implementation — 2026-06-13

Status:

- Complete.

Primary sources:

- Notion webhook overview, endpoint verification, event delivery, signature,
  event-type, and API-version documentation.
- Official `@notionhq/client` v5.22.0 package declarations, runtime artifact,
  README, release history, and Cloudflare compatibility fixes.
- Current Cloudflare Workers Fetch, Web Crypto, and workerd-testing
  documentation.

Clean-room affirmation:

- The design and future fixtures derive from Notion's primary specifications
  and original synthetic payloads. No third-party adapter implementation,
  types, fixtures, payloads, snapshots, or tests are being copied or
  translated.

Eligibility:

- Eligible for stateless HTTPS webhook subscriptions. Notion delivers a
  one-time unsigned `verification_token` request, then signs subsequent exact
  request bodies with HMAC-SHA256 in `X-Notion-Signature`.
- Events expose a unique delivery id, attempt number, workspace, subscription,
  integration, authors, resource identity, and API version. Notion retries
  failed deliveries up to eight times with exponential backoff and does not
  guarantee ordering.
- Notion documents no signed timestamp or replay window. The package can
  authenticate exact bytes and expose delivery identity, but application-owned
  deduplication is the only replay defense.
- The official client is Fetch-injectable and documents Cloudflare Workers
  compatibility after its v5.21 runtime fix. Actual SDK execution in workerd
  without `nodejs_compat` remains required before completion.
- Webhook subscription creation, OAuth, integration ownership, token storage,
  and event selection remain developer-owned setup.

Design:

- Add `@flue/notion`, `examples/notion-channel`, `flue add notion`, a setup
  guide, and an API reference.
- Publish one fixed `POST /webhook` route.
- Accept an optional `verificationToken` during the endpoint-verification
  phase and an optional `verification({ c, verificationToken })` callback.
  At least a configured token or a verification callback is required. The
  callback is explicitly unauthenticated because Notion supplies the token
  before a signing secret exists; it lets trusted application code capture the
  token without making installation lifecycle part of Flue.
- A verification request receives the normal handler-result contract, or an
  empty `200` for a matching configured token. Once a token is configured, it
  takes precedence over and blocks the temporary setup callback. Ordinary
  events require a configured verification token; an endpoint still awaiting
  configuration returns `503` so Notion can retry rather than invoking
  application code without authentication.
- Verify `X-Notion-Signature` against the exact body with Web Crypto before
  parsing or invoking the event callback. Support optional fixed
  `workspaceId`, `subscriptionId`, and `integrationId` checks with `403` on a
  signed mismatch.
- Type known events from the official SDK's exported webhook payload types,
  widened only where current primary docs allow author type `agent`. Preserve
  future verified event visibility through an explicit unknown-event wrapper
  rather than weakening known-event switch narrowing.
- Preserve the callback shape `webhook({ c, event })` and established response
  behavior: no value becomes empty `200`, JSON-compatible values become JSON,
  and ordinary Hono or Fetch responses pass through.
- Do not invent a handler deadline because Notion documents retries but no
  universal numeric response deadline.
- Do not expose a package-level conversation key. Notion has unrelated page,
  comment, database, data-source, view, and file identities, so applications
  choose the resource identity appropriate to each workflow.

Dependencies and example:

- `@flue/notion` depends directly on Hono and peers on
  `@notionhq/client` and `@types/node`; the packed strict consumer proved that
  the official declarations require Node types even though the runtime path is
  Fetch-only. The package does not depend on `@flue/runtime` and does not use
  the SDK client for ingress.
- The editable example exports the official Notion client with injected Fetch,
  groups useful page event cases, dispatches by an explicitly local page-based
  instance id, and defines a narrow page-retrieval tool bound to that
  already-selected page.
- Keep the verification callback visible but commented out in the example and
  recipe. Explain that it is temporary setup code and that the received token
  must be stored as `NOTION_WEBHOOK_VERIFICATION_TOKEN` before ordinary event
  delivery.
- Workerd tests must execute Web Crypto ingress verification and a real
  official SDK page request against fake Fetch without `nodejs_compat`.

Non-goals:

- Webhook subscription creation, event-selection policy, public-integration
  approval, OAuth, token rotation, installation persistence, deduplication,
  ordering, replay recovery, and broad outbound tools.
- Fetching full page or database state during ingress. Notion intentionally
  sends lightweight changed-resource notifications; the application decides
  when its project-owned client should retrieve current state.
- Treating workspace, subscription, integration, page, or delivery ids as
  authorization capabilities.

Foundation reflection to revisit after implementation:

- Whether the one-time unauthenticated verification callback fits the existing
  optional-surface conventions without shared routing changes.
- Whether peer-typing against a Fetch-compatible but CommonJS provider SDK
  exposes a repeated packed-consumer or Workers issue after Stripe.
- Whether page conversation identity is useful enough to keep provider-local
  without implying that every resource webhook has a conversation.

Implementation:

- Added `@flue/notion` with one fixed `POST /webhook` route, explicit unsigned
  setup-token handling, exact-byte HMAC-SHA256 verification, optional fixed
  workspace/subscription/integration checks, body limiting, SDK-derived known
  event types, future event/API-version fallback, and the established
  Hono-compatible response contract.
- Added original Node and workerd protocol suites. They cover exact bytes,
  missing, malformed, and incorrect signatures, unsigned setup capture,
  configured-token precedence, unconfigured signed delivery, fixed identity,
  content type, malformed and streamed lengths, body limits, malformed known
  payloads, optional principals, future events and API versions, representative
  comment/page/database/data-source/file/view families, handler results,
  failures, constructor validation, and route publication.
- Added `examples/notion-channel` with the official client, one shared
  Fetch-adapting client factory, grouped page events, a local page-based agent
  instance id, a page-bound retrieval tool, temporary setup guidance, and Node
  and workerd fake-Fetch tests.
- Added `flue add notion`, the Notion connector recipe, setup and API docs,
  navigation and channel overview entries, README, changelog, and publish
  wiring.

Validation:

- Package build, strict typecheck, 17 Node tests, and two workerd ingress tests
  pass. Workerd executes exact-byte Web Crypto verification and setup handling
  without requiring `nodejs_compat`.
- Example strict typecheck, Node fake-client test, workerd fake-client test,
  Node build, and Cloudflare target build pass. Both runtime tests execute the
  same exported `createNotionClient()` factory used to create the project-owned
  client and fail unexpected network destinations.
- A built Node application returned an empty `200` for an original locally
  signed future event and `401` for the same signature over altered bytes.
- The focused CLI suite passes, and the built CLI returns the Notion recipe
  through the locally built connector registry.
- Documentation typecheck and production build pass. The connector site build
  serves `/cli/connectors/notion.md`.
- Publish preparation and package packing pass. The tarball contains only the
  intended distribution files, prepared docs, README, license, and manifest.
- A clean strict TypeScript consumer installed only the packed
  `@flue/notion` package and `@notionhq/client`; required peers resolved,
  custom Hono environment types compiled, and the constructor imported at
  runtime.
- Credential-pattern, formatting, and whitespace checks found no logged or
  embedded real secret. No verification or client test contacted Notion.

Corrections and deviations:

- The published `@notionhq/client@5.22.0` contains webhook payload types but
  not the Web Crypto verification helpers added to the official repository
  shortly after that release. The channel implements the documented
  HMAC-SHA256 operation directly instead of depending on unreleased source.
- The package does not expose the initially proposed page conversation helper.
  Notion has no universal conversation across its unrelated resource families;
  the example instead labels its page-based instance id as an application
  convention.
- The configured signing token now takes precedence over the temporary setup
  callback. Accidentally leaving setup code present cannot route arbitrary
  unsigned values into application secret storage after configuration.
- The official SDK's published declarations omit documented `agent`
  principals and import `node:http`. The package widens `authors` and
  `accessible_by` to the documented principal set and declares
  `@types/node >=18` as a required peer. This adds no Node runtime code.
- The first clean consumer proved that projects constraining
  `compilerOptions.types` must include `"node"`; the recipe, guide, README,
  and example configuration now state that requirement.
- One parallel verification command raced an example Node build against a CLI
  rebuild that temporarily removed `dist/flue.js`. Ordered runtime, CLI, and
  example checks pass; this was verification ordering rather than a source
  defect.

Foundation reflection:

- Notion's setup handshake fits one fixed route without shared routing changes.
  Its unauthenticated callback remains provider-specific, and configured-token
  precedence supplies the safety invariant needed to keep it local.
- Known event validation must justify SDK-derived callback types. Notion's
  larger provider union required family-level structural checks and explicit
  future-version fallback; no generic cross-provider validator would reduce
  that provider-specific work safely.
- The repeated `@types/node` declaration friction seen with Stripe is caused by
  provider SDK type graphs, not Flue runtime code. Compatible required peers
  plus clean packed-consumer checks remain the least surprising solution.
- Fixed discovery, the single-object callback, normal response handling,
  example client ownership, and Node/workerd conventions all held. No shared
  channel machinery change is justified.

Focused review:

- Independent review found that the first known-event guard retained optional
  SDK fields such as `accessible_by` without validating them. The final
  implementation validates every retained base field and each supported
  resource-family payload before exposing SDK-derived types; malformed
  principals and family data receive `400`.
- Review found that the first example tests created separate SDK clients.
  Production and tests now share the exported `createNotionClient()` factory,
  so Node and workerd cover the actual Fetch adapter used by `client`.
- Review found stale roadmap claims about a canonical page key and setup-token
  precedence. The design and implementation log now match the shipped local
  page convention and configured-token behavior.
- No unresolved correctness, security, packaging, Cloudflare, or developer
  experience findings remain.

### Resend implementation — 2026-06-13

Status:

- Complete.

Primary sources:

- Resend webhook management, signature verification, retry/replay,
  `email.received`, inbound email, content retrieval, attachment, and reply
  documentation.
- Official `resend` v6.12.4 package metadata, declarations, runtime artifact,
  and Standard Webhooks dependency.
- Standard Webhooks verification specification and the official JavaScript
  implementation used by Resend.
- Current Cloudflare Workers Fetch and workerd-testing documentation.

Clean-room affirmation:

- The design and fixtures derive from Resend's primary specifications and
  original synthetic payloads. No third-party adapter implementation, types,
  fixtures, payloads, snapshots, or tests are being copied or translated.

Eligibility:

- Eligible in principle for stateless HTTPS webhooks. Resend signs the exact
  request body plus `svix-id` and `svix-timestamp`, applies a five-minute
  timestamp tolerance through its official verifier, and delivers at least
  once with exponential retries and manual replay.
- The `svix-id` header is the stable delivery identifier for
  application-owned deduplication. Ordering is not guaranteed.
- `email.received` contains address, message, subject, and attachment metadata,
  but intentionally omits bodies, complete headers, and attachment content.
  Applications retrieve those later through the project-owned Resend client.
- The official SDK uses global Fetch for ordinary API calls and pure
  JavaScript Standard Webhooks verification. Its package is named and
  engine-constrained for Node, so actual verifier and client execution in
  workerd without `nodejs_compat` is a completion gate rather than an inferred
  compatibility claim.

Design:

- Add `@flue/resend`, `examples/resend-channel`, `flue add resend`, a setup
  guide, and an API reference.
- Publish one fixed `POST /webhook` route.
- Accept the project-owned official Resend `client` and `webhookSecret`.
  Verification uses `client.webhooks.verify()` over the exact raw string and
  original `svix-*` headers before application code runs.
- Deliver the explicitly supported SDK event variants as their provider-native
  typed payloads. Validate every retained field before exposing those types and
  preserve other verified event types through an explicit unknown-event
  wrapper.
- Pass header-derived delivery metadata alongside the event in the extensible
  callback object. Preserve the unique delivery id and signed timestamp
  without claiming built-in deduplication.
- Preserve the established response contract: no value becomes empty `200`,
  JSON-compatible values become JSON, and ordinary Hono or Fetch responses
  pass through. Resend documents no universal numeric response deadline, so
  the package will not invent one.
- Expose a configurable body limit and require JSON media type. Invalid,
  missing, stale, or malformed authentication receives `400`; oversized
  requests receive `413`; unsupported media receives `415`.
- Do not add a package-level conversation helper. `message_id` identifies one
  received message and supports `In-Reply-To`, but later messages in the same
  email thread have different message ids and root-thread reconstruction
  requires headers that are not present in the webhook.

Dependencies and example:

- `@flue/resend` depends directly on Hono and peers on `resend`. A required
  `@types/node` peer is expected because the official SDK's public attachment
  declarations expose `Buffer`; the clean packed-consumer check will confirm
  the final requirement.
- The editable example exports the official client, handles
  `email.received`, dispatches using an explicitly local message-based agent
  instance id, and defines a narrow tool that retrieves the already-bound
  received email. Outbound sending and reply policy remain application-owned.
- Node and workerd tests will execute the same exported client factory against
  a fake Fetch destination and fail any unexpected network access.

Non-goals:

- Receiving-domain setup, MX records, webhook registration, secret rotation,
  API-key storage, deduplication, ordering, replay persistence, attachment
  storage, outbound composition, and reply authorization.
- Treating a Resend message id, email id, recipient, webhook delivery id, or
  signing secret as an authorization capability.
- Polling through the Resend CLI or adding a general inbound-email abstraction
  shared with unrelated providers.

Foundation reflection to revisit after implementation:

- Whether a second official SDK-owned verifier strengthens the existing
  provider-local exception established by Stripe without requiring shared
  channel machinery.
- Whether delivery metadata belongs cleanly beside `event` in the callback
  object and whether any existing provider would gain a concrete correctness
  benefit from the same shape.
- Whether a Fetch-based SDK whose declarations and package metadata remain
  Node-oriented exposes a new example, peer-type, or workerd-validation
  requirement beyond the Stripe and Notion precedents.

Implementation:

- Added `@flue/resend` with one fixed `POST /webhook` route, official SDK
  verification over exact UTF-8 request bytes, signed delivery metadata,
  provider-native known event variants, verified unknown-event normalization,
  body limiting, structural event validation, and the established
  Hono-compatible result contract.
- Added original Node and workerd protocol suites. They cover exact bytes,
  missing, malformed, incorrect, stale, and future authentication, known email,
  contact, and domain families, malformed known payloads, future event types,
  media type, invalid UTF-8, declared and streamed body limits, delivery
  identity, handler results, constructor validation, and route publication.
- Added `examples/resend-channel` with the official client, a shared client
  factory, `email.received` dispatch, an explicitly local message-based agent
  instance id, a narrow received-email retrieval tool, and Node and workerd
  fake-Fetch tests.
- Added `flue add resend`, the Resend connector recipe, setup and API docs,
  navigation and channel overview entries, README, changelog, and publish
  wiring.

Validation:

- Package build, strict typecheck, nine Node tests, and two workerd ingress
  tests pass. Workerd executes the official Resend verifier over exact bytes
  with `process` and `Buffer` explicitly unavailable.
- Example strict typecheck, Node fake-client test, workerd fake-client test,
  Node build, and Cloudflare target build pass. The workerd client test
  executes `emails.receiving.get()` through the official SDK with `process`
  and `Buffer` explicitly unavailable.
- A separate clean workerd consumer installed only the packed
  `@flue/resend`, `resend`, declaration peers, and the Workers test runner. It
  executed both verification and the receiving-email Fetch path without React
  runtime packages, Node globals, or `nodejs_compat`.
- A built Node application returned an empty `200` for an original locally
  signed future event and `400` for the same signature over altered bytes.
- The full CLI suite passes: 53 Node tests and 24 Vitest tests. The real built
  CLI returns the Resend recipe through the locally built connector website.
- Documentation check and production build pass. The connector website build
  serves `/cli/connectors/resend.md`.
- Publish preparation and package packing pass. The tarball contains 95
  intended distribution, documentation, README, license, and manifest files.
- A clean strict TypeScript consumer installed only the packed package,
  `resend`, and the required declaration peers; custom Hono environment types
  compiled and the constructor imported at runtime.
- Formatting, whitespace, and local credential-pattern review found no real
  provider secret or authentication logging. No test or build contacted
  Resend.

Corrections and deviations:

- The official SDK's public declarations import React types and expose
  `Buffer`, despite the verified Fetch and Standard Webhooks runtime paths
  requiring neither React nor Node. `@flue/resend` therefore declares
  compatible `@types/react` and `@types/node` peers, and the recipe explains
  that both are declaration-only requirements.
- The package pins its known event-name union rather than aliasing the SDK's
  entire evolving `WebhookEventPayload`. This prevents a compatible future SDK
  minor from advertising a newly added event as provider-native before this
  package validates its payload; other verified event types remain observable
  through the unknown wrapper.
- Resend's official Cloudflare documentation supports the SDK, but some
  helpers are not uniformly edge-safe. In particular, wrapped inbound
  forwarding can use `Buffer`. The example intentionally demonstrates only the
  receiving-email retrieval path proven in workerd and does not make a blanket
  claim about every SDK method.
- The first direct `flue add resend --print` check used the deployed registry
  and correctly could not see unreleased repository content. The final check
  points the built CLI at the locally built connector website through
  `FLUE_REGISTRY_URL`, matching the pre-release integration contract.

Foundation reflection:

- Resend reinforces that accepting a project-owned provider SDK for verified
  ingress is a provider-local exception justified when the official verifier
  owns timestamp tolerance, signature rotation syntax, and native event types
  and actually executes in both required runtimes. No shared verifier
  abstraction is warranted.
- Delivery metadata fits naturally beside `event` in the extensible callback
  object. Existing channels already expose equivalent provider metadata either
  on normalized events or delivery objects; no concrete failure requires
  changing their public shapes.
- The repeated SDK declaration friction from Stripe, Notion, and Resend is
  best caught by packed strict-consumer checks. The exact peer set remains
  provider-specific, so a shared runtime or package abstraction would not
  improve correctness.
- Fixed discovery, Hono context typing, response handling, project-owned
  clients and tools, and Node/workerd validation all held. No shared channel
  machinery change is justified.

Focused review:

- Independent review found that the standard `Response` passthrough contract
  could let an application return `202` or `204` without realizing Resend
  retries every status other than `200`. The package intentionally preserves
  the normal Hono response API so applications can request redelivery. Source
  JSDoc, the test name, README, guide, API reference, and connector recipe now
  state that only `200` acknowledges delivery and non-`200` responses
  intentionally trigger retry.
- No unresolved correctness, security, packaging, Cloudflare, or developer
  experience findings remain.

## 6. Keep These As Separate Product Decisions

### Generic HTTP or webhook adapter

Flue already supports `flue add <provider-docs-url> --category channel` and a
custom-channel guide. A generic package cannot safely supply provider
verification, identity, retry, or response semantics.

Improve the custom-channel recipe, reusable test fixtures, and conformance
helpers before considering a generic runtime abstraction. Public demand:
<https://github.com/vercel/chat/issues/96>.

### Agent Client Protocol

ACP may be a direct agent transport rather than a provider webhook channel.
Evaluate its routing, session identity, streaming, and authentication against
Flue's existing agent HTTP and WebSocket surfaces before assigning ownership.
Public request: <https://github.com/vercel/chat/issues/552>.

## 7. Unsupported Transport Classes

Slack Socket Mode, Discord Gateway, Telegram polling, and similar persistent
connections are out of scope. They require lifecycle, reconnection, cursor,
heartbeat, and durable ownership semantics that the current HTTP channel model
does not provide.

Do not add a provider that requires one of these transports. Reconsider this
only through a separate product decision that intentionally introduces a
long-lived transport model; do not approximate it through channel route
declarations.

## Suggested Sequence

1. Release and deploy the completed ten-provider work.
2. Add the channel implementation and conformance agent skill.
3. Research Stripe, Notion, Resend, Shopify, Intercom, and Zendesk one at a
   time, shipping only after the HTTP and Cloudflare gates are proven.
4. Reassess existing HTTP provider expansions from user demand after the first
   channel release has real adoption data.

No additional channel was added during the final audit. Starting another
provider after the completed cross-provider review would require a fresh
research, implementation, testing, and audit cycle; the candidates above are
better handled as independent workstreams.
