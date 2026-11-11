# Seter 3D object kit

Single frosted-glass objects, one per card, used in the NEAR tech cards, the proof header, the order verdicts, empty,
error and setup states and the vault success line. They match the approved Seter art already in `public/art` (the
glass envelope, enclave cube, seal and slips), which stays as it was. The trading chart area has no 3D art.

- **Material:** frosted violet glass: a translucent, softly frosted body with a mint inner glow, small porcelain-white
  satin ceramic details (check marks, keyholes, the exclamation mark, the chip) and a lavender rim light. No metal
  chrome, no brushed silver, no enamel.
- **Palette:** glass violet `#6b55e0` (near the app accent `#5a46d4`), inner glow mint `#5fe3b8` (the slit in the Seter
  mark), porcelain `#f4f3ef` (the app background), rim light lavender `#b9adff` (the dark-mode accent). The warning sign
  alone glows coral `#f07c7c`, the app's own dark-mode down colour.
- **Face:** none. Seter is a serious fintech product, so every object is the object alone.
- **Background:** transparent (no ground shadow), square 1024 source, webp at 640 px; they sit on the porcelain
  surfaces and on the aubergine verdict card.
- **Subjects:** padlocked envelope, shield over a price line, candlestick with a veiled level, eye with a slash,
  padlock, alarm bell, coin sealed in a glass capsule, attestation certificate, chip badge, check-mark token, empty
  order tray, warning sign, slit-tile logo-mark candidate.

Style line used in every prompt (ChatGPT, one image per message, one chat for the set):

> Frosted violet glass 3D render: a translucent, softly frosted glass body in violet #6b55e0 with a soft mint #5fe3b8
> inner glow, small soft porcelain-white #f4f3ef satin ceramic details, and a gentle lavender #b9adff rim light, soft
> studio lighting, crisp reflections, rounded bevelled edges, precise and serious fintech proportions, no face, no
> character, centred, transparent background (no background, no ground shadow), square 1024x1024, no text, no letters,
> no numbers, no logos.

## Objects and where they are used

Files: `packages/web/public/art/3d/seter-3d-<name>.webp`, rendered by `Obj` in `packages/web/src/ui.tsx` (fixed width
and height, alt text, a 4 px float over 6 s that is off under `prefers-reduced-motion`). `State` takes an `art` prop.

| Object | Used on |
|---|---|
| `badge` (chip medal) | Landing, NEAR tech card "OutLayer TEE execution" |
| `success` (check token) | Landing, tech card "Promise-origin check"; vault sheet, "Deposit / Withdrawal complete" line |
| `certificate` | Landing, tech card "Enclave signature"; order page, "No recorded attestation" state |
| `lock` | Landing, tech card "Keys only the build holds"; order panel "Setup required: enclave keys"; order page verdict for a cancelled (never revealed) order |
| `shield-price` | Landing, tech card "Locked-down runs" |
| `coin` (coin in a glass capsule) | Landing, tech card "Testnet settlement"; vault sheet "No wallet connected" |
| `candle-hidden` | Landing, "Live proof" section header |
| `bell` | Order page verdict for a fired order |
| `eye-slash` | Order page verdict for an armed order; "Page not found" |
| `envelope-lock` | Order page, "What the chain stores" heading |
| `tray-empty` | Terminal "Open orders" and "Order history" empty tables; order page "No order №… on the contract" |
| `warning` | Every read-error state: orders table, enclave key, landing proof, order page |
| `mark` | Logo-mark candidate only, not wired (the approved `seter-mark.webp` stays) |

3D art generated with ChatGPT.
