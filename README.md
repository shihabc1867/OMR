

## Sections, section results, group delete (v10)
- **Sections (Answer Key tab):** optional. Add sections such as Bangla 1–15, English 16–50 (up to 6; name + first and last question). Sections cannot overlap. Questions that are not in any section are counted only in the total. An answer key without sections works exactly as before.
- **Section result:** every section has its own correct / wrong / blank and marks (negative marking applied). A student below **Section pass mark %** (Settings, default 40) FAILS that section; everything of that section is shown in red (scan result, Results list, merit-list PDF cell, student PDF line and the answers of that section).
- **Total result:** all sections together (correct, wrong, marks). Below the **Pass mark %** of the total marks = FAILED and the whole row / page is red. Failing one section does not fail the student overall.
- **Second Timer** is taken from the total only, not from any section.
- **Merit list PDF:** one column per section (marks of that section) between Name and Positive. **Student PDF:** a "Section-wise result" block. **CSV:** extra columns per section (correct, wrong, blank, marks, percent, status).
- **Live scan:** the result card also names failed sections.
- **Groups tab:** 🗑 Delete group for the admin (every group) and for the group owner. The admin sees all groups; Invite / Rename / Leave only for groups they belong to.
- Sections are saved inside the answer key. If the server does not return the new `sections` field the phone keeps its own copy (so another phone may not see them until Code.gs stores the field).
