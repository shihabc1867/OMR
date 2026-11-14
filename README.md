# OMR Scanner (installable PWA + Google Apps Script + GitHub Pages)

Grade **any** OMR answer sheet with a phone camera. Take a photo of a blank copy of your sheet once and the app learns the layout (bubbles, questions, options). Then set an answer key, photograph students' sheets, fix any missed bubble by tapping, and submit to get correct / wrong / score.

## Features
- **Any OMR sheet**: add a sheet type by photographing a blank sheet. Any number of questions, columns, or options (2-10), options running across or down, any numbering order (down columns, across rows, or by blocks). A built-in 100-question sheet (landscape, 4 columns × 25 rows, options a b c d, 4 black corner squares) is included and can be printed on A4 landscape.
- Answer key: choose the sheet type, tap the correct option for as many questions as you want, give it a name, save. Keep many keys.
- Scan: photo → corners found automatically (black corner squares, or the paper edges) → image straightened → every bubble measured → a light blue circle appears on every marked option.
- Fix by hand: tap a missed bubble to add it (it becomes a circle too), tap again to remove it. Drag the corner handles if the automatic corners are off; "Rotate" if the sheet is upside down or sideways.
- Submit: correct, wrong, unanswered, score. Default −0.25 per wrong answer. A "Second Timer" button deducts 3% (or 5%, or anything) of the total marks. The admin edits all values in Settings.
- Multiple marks on one question count as wrong. Blank questions are not penalised. Only questions that have an answer in the key count.
- Admin PIN protects settings, keys and sheet types. Results list with the wrong question numbers, CSV export.
- Installable (PWA) and works offline. Optional cloud sync through Google Apps Script + Google Sheets, so several phones share keys, sheet types and results.

## Files
| File | Purpose |
|---|---|
| `index.html` | UI |
| `app.js` | UI logic, sheet types, answer keys, scoring, sync |
| `omr-core.js` | OMR engine: corner detection, perspective correction, bubble detection, grouping, darkness measurement |
| `sw.js`, `manifest.json`, `icon-*.png` | Install + offline support |
| `Code.gs` | Google Apps Script backend |

## Deploy
### 1. GitHub Pages
1. Create a new public repository (for example `omr-app`).
2. Upload all files (Add file → Upload files). `Code.gs` and this README can be uploaded too; they are harmless.
3. Settings → Pages → Source: *Deploy from a branch* → branch `main`, folder `/ (root)` → Save.
4. After a minute the app is live at `https://<username>.github.io/omr-app/`.

### 2. Apps Script backend (optional, for sync across devices)
1. Create a Google Sheet → Extensions → Apps Script. Paste `Code.gs`, save.
2. Project Settings → Script properties → add `ADMIN_PIN` with your own PIN.
3. Deploy → New deployment → *Web app* → Execute as **Me**, access **Anyone** → Deploy and authorise.
4. Copy the `.../exec` URL.
5. In the app: Settings → enter the PIN (initially `1234`), paste the URL, type the same PIN from step 2 in **New PIN**, Save.
6. After changing `Code.gs`, redeploy via Deploy → Manage deployments → Edit → New version.

### 3. Install on the phone
- Android Chrome: the “Install” button in the app, or ⋮ menu → Install app.
- iPhone: Safari → Share → Add to Home Screen.

## How to use
1. **Sheets tab → Add any OMR sheet**: photograph a *blank* sheet on a flat surface, with the whole page visible and good light. Check the four corners, then check the red circles and question numbers. Adjust *Options per question*, *Options run*, *Question numbering* if needed; tap a bubble to remove a false one, tap an empty spot to add a missed one. Name it and save.
   - Tip: if your sheet has black corner squares the app uses them (most accurate). Otherwise it uses the paper edges, so photograph against a darker background.
2. **Answer Key tab**: pick the sheet type, tap the right answers, name the key, Save.
3. **Scan tab**: pick the key, enter the student name/roll, take the photo, fix circles if needed, press **Submit**. Optionally press **Second Timer** before submitting.
4. **Results tab**: all results, CSV download. **Settings tab**: marks per correct, wrong penalty, Second Timer %, detection threshold, PIN, sync URL.

Score = `correct × marks − wrong × penalty − (Second Timer on ? total × % : 0)`, never below 0.

## Photo tips
- All four corners / the whole sheet must be visible and in focus; hold the phone roughly above the sheet; avoid strong shadows.
- Mark bubbles firmly with a dark pen or pencil. If faint marks are missed, lower *Mark detection threshold* in Settings (e.g. 0.12). If stray marks are picked up, raise it (e.g. 0.25).
- Use the blank sheet photo for creating the template, never a marked one (filled bubbles are not recognised as bubbles).
- A sheet type made with manually placed corners (`alignment: manual`) will ask you to place the corners for every scan. Auto-detected ones do not.

## How it works
1. **Corners**: find 4 black squares, or otherwise the large bright page region, and order them clockwise.
2. **Straighten**: a perspective transform maps the photo onto the template's coordinate frame (so tilt, rotation and perspective do not matter).
3. **Orientation**: the app tries the plausible rotations and keeps the one where the printed bubble outlines line up with the template.
4. **Measure**: for each bubble, darkness = 1 − inside brightness / surrounding paper brightness (robust to shadows), minus the sheet-wide median (ignores printed letters in the bubbles).
5. **Decide**: darkness above the threshold = marked; two or more strong marks on a question = multiple marks.
6. **Learning a sheet**: on the straightened blank sheet it finds the bright inside (hole) of every bubble outline, so bubbles that almost touch each other are still separated; printed letters and numbers are rejected by size and shape. The bubbles are then grouped into rows, split into questions by gap size, and numbered by the chosen order.

Tested automatically: the engine reads 60-, 50-, 40- and 100-question synthetic sheets with 4 or 5 options, options across or down, and column, row or block numbering, from tilted photos with shadows and noise, with 0 errors; and the full app flow in headless Chrome with the built-in sheet and with a learned custom sheet. It has **not** been tested on real printed sheets with your phone, so run 20-30 real sheets first and tune the threshold.

## Known limits
- Bubbles must be circles/ovals/rounded boxes with an empty centre. Sheets that print only letters in boxes with no outline are not supported.
- Sheets without black corner squares need the whole paper in the photo.
- Student ID/roll-number bubble grids and multiple set codes (A/B/C/D papers) are not read yet; enter the name or roll by hand. You can still use such a sheet: only add the answer bubbles by removing the others with a tap.
- The admin PIN is light protection stored in the browser. Treat the Apps Script URL as a secret (access is "Anyone").

## Roadmap
1. (this version) Any-sheet templates, keys, scan, manual fix, scoring, PWA, Sheet sync.
2. Calibrate on real sheets (30-50 scans), tune thresholds, collect failure cases.
3. Roll / set-code bubble grids, per-question marks, several correct answers per question.
4. Batch scanning, merit lists, statistics, PDF reports.
5. Server-side PIN hashing and per-user accounts.


## Strict marking rules (v4)
- A question with **two or more marked bubbles** counts as wrong.
- A bubble that is only **partly filled** (half shaded, tick, dot, faint wash) counts as wrong. Settings → "Minimum fill %" (default 70) controls how much of the bubble must be covered.
- Such questions are shown in orange after scanning; tapping a bubble by hand clears the flag for that question.

## Corner squares
The finder removes thin lines (page borders, text) before looking for solid squares, checks that each square has plain paper around it, tries several thresholds, and uses the template's width/height ratio to pick the right four. Works when the whole sheet is photographed with background around it.

## Corner squares and custom sheet types (v5)
- When a sheet type is created, the positions of the black corner squares are saved with it (`mk`), even if the four handles were placed somewhere else (e.g. on the bubble area).
- Scanning then lines the photo up on the squares automatically. Squares are told apart from filled answer bubbles by their corners.
- Older sheet types saved without this: do one manual alignment (Adjust corners → Done); the app learns the squares and later scans are automatic. Or re-create the sheet type.


## Live camera scan (v6, part 1)
- Scan tab → **Live scan**: the camera shows a box on the four black squares (orange while moving, green when locked). When locked, **Read & Submit** appears (or tick **Auto-submit**). A clean sheet is saved at once and the camera stays on for the next sheet; anything doubtful (two marks, partly filled, bad alignment) opens the normal review screen. Remove the scanned sheet before showing the next one.

## Question papers (v6, part 2)
- **Questions** tab: add 1–100 questions by hand or paste them all at once (`1. text` + `(a) … (b) … (c) … (d) …`, Bengali `১।` / `ক) খ)` also work; `Ans: b` or a `*` after an option marks the answer).
- Heading lines (4 lines + info line) and a logo can be set per paper. Up to 60 questions fit one A4 page, more use two pages. **Preview pages** / **Download question paper (PDF)**.
- **Save paper & answer key** stores the paper in the open workspace (everyone in a group sees it) and creates an answer key linked to the chosen OMR sheet type, ready in the Scan tab.
- Backend: `Code.gs` has a new `Papers` sheet (created automatically). Redeploy a **New version** after pasting it.


## Secret key login, no lock-out, admin recovery (v7)
- Users log in with **ID + password + secret key**. The key (`OMR.<id>.<secret>.<check>`) contains the server address, so nobody pastes the long address any more. It is saved on the phone after the first login. Old-style addresses are still accepted in the same box.
- Admin: Profile tab → **Secret key** card → Copy key / Copy login link (tapping the link fills the key automatically). "Require the secret key to log in and sign up" is **off** until the admin switches it on. "Make a new key" invalidates the old one.
- Wrong passwords no longer lock an account for 10 minutes.
- Forgot the admin password? Apps Script editor → choose **resetAdminPassword** → Run → read the new password in the Execution log. If everybody is locked out by the secret key, run **disableSecretKey**.


## Questions tab, results and groups (v8)
- Heading lines each have their own **B / I / U**, size (pt) and font. Question text uses Times New Roman (English) and SutonnyOMJ (Bangla), default **12 pt**, with A−/A＋. SutonnyOMJ must be installed on the phone, or add its `.ttf` once under *Fonts* (kept on the phone).
- Inside a question: `<b>…</b> <i>…</i> <u>…</u>` (or the B/I/U buttons), maths between dollar signs (`$x^{2}$`, `$H_{2}O$`, `$\frac{a}{b}$`, `$\sqrt{x}$`, `$\alpha$ $\pi$ $\times$ $\leq$ …) and one picture per question (🖼 Picture; kept small so it fits in a Sheets cell). A live preview appears under questions that use them.
- Pasted questions are put in the order of their numbers. ↑ ↓ ⇅ reorder questions. Options: very short → one line, medium → two per line, long → one per line.
- "Shrink the text to fit" keeps ≤60 questions on one A4 page and more on two; switch it off to keep the exact size (more pages if needed).
- Results tab: **Delete all results shown** (the chosen answer key, or every key); single results still have their own Delete.
- Admin tab: **Delete** a group (removes its members, answer keys, results, papers and pictures). Backend: new sheet `PaperImages`; new actions `deleteResults`, `deleteGroup`.


## Stricter ink detection, sharp PDFs, negative totals, edit student info (v9)
- **Detection (omr-core.js):** a bubble counts as marked only when its centre holds thick, pen-black ink (a pixel at least 60% darker than the local paper and part of a solid blob). Measured on the inner half of the bubble, re-centred on the printed ring, with the printed letters inside the bubbles removed per option column. Light pencil, ghost/erased marks, smudges, shadows, dust specks, thin ticks and printed letters are ignored. Half-filled or two-bubble answers still make the question invalid. "Mark strictness" in Settings (default 0.30) is reset once to the new default.
- **Pencil:** dark pencil is no longer read. Use a pen (blue/black).
- **PDF:** result sheets and question papers are drawn at 360 dpi (2976 x 4210 px per page) instead of 150 dpi. Pictures you add to a question keep a sharp original on the phone that made the paper (the shared copy in the group is small).
- **Negative totals** are shown as they are (for example -1.5) in the list, PDFs and CSV; older results that were saved as 0 are recalculated.
- **Edit student info:** Results → ✏️ Edit changes name and Roll/ID of a saved result (also in the live-scan result card).
