# BUILD-BRIEF — hidden-spec-cli-01-run-20261122: mend

Bounty: "Build mend, one patch tool for every AI edit format" — $100 (10 × $10), GRATIS.
Opens: 2026-11-22 14:00 UTC (21:00 WIB 22 Nov). Deadline: 2026-11-24 14:00 UTC (21:00 WIB 24 Nov).
Harness: agent/v1. Kit level: bundle e84af0dba61b58cafed98a5a45ae58e1dacca571a694dd9ca8ecd17b76c93d8c.
Repo: lycann666/hidden-spec-cli-01-run-20261122 (dibuat SETELAH opens, publik, LICENSE MIT).
Entrypoint: main.ts (Node 22 stdlib saja), runner.ts kit apa adanya.

## Checklist SPEC.md (Tahap 1)

- [ ] §1 CLI: `--format=NAME` (auto/unified/search-replace/v4a/json), `--check`, `--strict`,
      PATCH posisi / `-` = stdin, opsi+posisi urutan bebas, `--` akhiri opsi.
      Usage error: arg `-...` tak dikenal (sebelum `--`), opsi ganda, `--format` di luar 5 nama,
      >1 posisi. (starter sudah — JANGAN ubah)
- [ ] §2 Output: stdout hanya baris `\n`. Exit 2 satu baris: `error: usage` / `error: no-patch` /
      `error: format` / `error: parse <N>` (tanpa edit = parse 1). Urutan: usage > no-patch/format >
      parse sebelum file dicek. Exit 1: `error: <code> <path>` per edit gagal (urutan patch) +
      `failed: <k> of <n> edits`. Exit 0: baris perubahan urutan byte path + `ok: <n> files` / `ok: 1 file`.
      `R <old> -> <new>` ganti pasangan D+A, urut by `<new>`. File tak berubah tak dicantumkan.
- [ ] §3 File: UTF-8. Path aman: tak kosong, tak mulai `/`, tak ada `\`, segmen tak kosong/`.`/`..`.
      Line break file = CRLF bila LF pertama didahului CR, else LF. File diubah ditulis dgn break
      sendiri + final break spt semula (kecuali §6 unified). File dibuat: LF, akhiri break kecuali
      format bilang lain. JSON create: file_text byte-for-byte. Patch lines: split `\n`, buang satu
      `\r` akhir, tanpa potongan kosong setelah `\n` akhir.
- [ ] §4 Deteksi auto: (1) baris non-blank pertama trim == `*** Begin Patch` → v4a; (2) karakter
      non-ws pertama baris non-blank pertama `[`/`{` → json; (3) ada baris trimEnd ==
      `<<<<<<< SEARCH` → search-replace; (4) ada baris `diff --git ` atau `--- ` diikuti `+++ ` →
      unified; else `error: format`. (starter sudah)
- [ ] §5 Matching 3 tier (0 exact, 1 trim trailing sp/tab, 2 trim leading+trailing sp/tab), tier
      pertama yg ada ≥1 kemunculan; `--strict` hanya tier 0; tak ada → no-match. Context line ditulis
      spt baris file yg cocok, bukan patch. Tier 2: baris N non-context, tak kosong, tak hanya ws,
      berawalan P (leading sp/tab baris pertama O) → P diganti F (leading baris pertama file yg cocok).
- [ ] §6 Unified: section dari `diff --git a/<X> b/<Y>` atau `--- `+`+++ `; header: `---`/`+++` path
      (s.d. tab pertama, trim spasi, `/dev/null` = tak ada, buang awalan `a/`/`b/`), `rename from/to`,
      `new/deleted file mode`, path diff --git sbg fallback; `index`/`old mode`/`new mode`/
      `similarity`/`dissimilarity`/`Index:` + lain diabaikan. `--- ` tanpa `+++ ` di header →
      `error: parse <baris sesudahnya>`. `diff --git` tak sesuai bentuk → parse <barisnya>.
      Hunk `@@ -A[,B] +C[,D] @@` (+teks opsional); `@@` lain → parse; hunk sebelum section → parse.
      Body: ` `/`-`/`+`/`\`/kosong (kosong = context kosong); berakhir di baris lain / `diff --git ` /
      `--- `+`+++ ` / akhir patch; baris kosong akhir body bukan bagian body. Di luar body, baris
      bukan header diabaikan (prosa, fence).
      Edit per section: create (old /dev/null atau new file mode; new tak ada else exists; file = semua
      baris `+`); delete (new /dev/null atau deleted file mode; old ada else missing; hunk tak dibaca);
      move (old≠new; old ada else missing, new tak ada else exists; hunk diterapkan ke old, tulis di new,
      hapus old); change (path ada else missing).
      Hunk berurutan, d = Σ(N−O) hunk sebelumnya. O tak kosong: kemunculan di tier tsb yg posisinya
      terdekat A−1+d (seri → lebih awal). O kosong: sisip sesudah A+d baris pertama. `\` mengacu baris
      body sebelumnya. Bila match sampai akhir file (atau sisip di akhir): hasil akhiri break KECUALI
      `\` mengikuti context/`+` terakhir hunk; bila tidak, final break tetap. File dibuat akhiri break
      KECUALI `\` mengikuti `+` terakhir. Gagal satu hunk → section gagal dgn kode hunk itu.
- [ ] §7 SEARCH/REPLACE: blok path + `<<<<<<< SEARCH` + old + `=======` + new + `>>>>>>> REPLACE`
      (marker dicocokkan dgn trailing ws dibuang). Path = baris terdekat sebelum SEARCH, setelah
      REPLACE blok sebelumnya (atau awal), tak blank, trim tak mulai ``` ; path = baris itu di-trim.
      Tak ada → path blok sebelumnya; blok pertama tanpa itu → `error: parse <baris SEARCH>`.
      SEARCH tanpa `=======` lalu `>>>>>>> REPLACE` → parse <baris SEARCH>. Baris luar blok diabaikan.
      Per blok: old kosong → buat file dgn new (else exists); else file ada (else missing), old muncul
      tepat sekali di tiernya else ambiguous; new ganti old.
- [ ] §8 V4A: baris non-blank pertama `*** Begin Patch` else parse <baris itu> (parse 1 bila tak ada);
      baris non-blank terakhir `*** End Patch` else parse <jml baris patch + 1>. Blank akhir section
      bukan bagian section. Section: `*** Add/Delete/Update File: <path>`; blank antar section diabaikan;
      baris lain → parse <barisnya>. Add: baris `+...` atau kosong; file = baris-barisnya, diakhiri break.
      Delete: tanpa baris. Update: `*** Move to: <path>` boleh sbg baris pertama, lalu chunk. Chunk dari
      `@@` (teks setelahnya trim = anchor; kosong = tanpa anchor) atau, utk chunk pertama, dari baris body.
      Body: ` `/`-`/`+`/kosong. `*** End of File` akhiri chunk + jangkar ke akhir file. Update tanpa chunk
      dan tanpa Move to → parse <baris Update File>.
      Per section: Add (tak ada else exists); Delete (ada else missing); Update (ada else missing;
      Move to: new tak ada else exists). Chunk berurutan, cursor dari 0. Chunk ber-anchor: cari baris
      pertama ≥ cursor yg sama dgn anchor di tier pertama yg ada (satu baris), else no-match; cursor
      lewat baris itu. O = context+`-`, N = context+`+`. Chunk ambil kemunculan pertama O ≥ cursor di
      tier pertama yg ada; chunk end-of-file hanya kemunculan yg berakhir di baris terakhir file. O kosong:
      sisip di cursor (atau akhir file utk eof). Cursor lalu ke sesudah baris yg ditulis. Move to: tulis
      di new, hapus old.
- [ ] §9 JSON: array atau JSON Lines; array: fault apa pun → parse <baris array mulai>; JSONL: baris
      bukan satu edit object valid → parse <baris itu>. create/str_replace/insert sesuai starter.
      (starter sudah — JANGAN ubah)
- [ ] §10 Order+atomik: edit berurutan pada tree hasil edit sebelumnya; semua path dicek aman dulu;
      edit gagal tak ubah apa-apa, edit sesudahnya tetap jalan, semua failure dilaporkan; bila ada yg
      gagal tak ada file ditulis (exit 1); bila tak ada yg gagal semua perubahan ditulis (exit 0),
      `--check` tak tulis apa-apa.
- [ ] Ukuran: ≤1 MiB per file, ≤4 MiB source total. Deterministik, tanpa waktu/random.
- [ ] README template 3 badge (repo_about: deskripsi + homepage + topik makefun,ai-agents,bounties,code).
- [ ] Repo About GitHub diset sebelum submit (via parent/browser — subagent tak bisa gh auth).
- [ ] Bundle: --prompt-file kata-kata user, --prompt-origin handed-off, --mcp none, --harness muse-app
      --harness-version 1 --provider ipnext --model ipnext/avocado-5.17-v2 --effort default,
      + --muse-usage (≥1 row). Check bundle ok:true sebelum submit.
- [ ] Submit SEKALI (kuota hari UTC 22 Nov tinggal ~1 slot; cap 6/hari high-risk). Bila ditolak kuota:
      JANGAN retry berulang — lapor + submit ulang setelah reset 07:00 WIB 23 Nov.
- [ ] Poll GET /api/submissions/<id>/status sampai finished + error null. "submitting" BUKAN bukti.

## Bukti lulus (diisi saat Tahap 3)
- check.ts practice: 100/100, skor 1000 (2026-11-23 ~00:15 WIB, Node 24 lokal; grader Node 22 — kode hanya stdlib, sintaks erasable)
- 34/34 extra edge-case SPEC (unified/V4A/SR/CLI, di luar practice) lolos
- bundle check: ok:_
- submit: id _, claim _, status API _
- BLOKIR 23 Nov ~01:48 WIB: repo GitHub lycann666/hidden-spec-cli-01-run-20261122 BELUM ada (404 terverifikasi). create_repository via GitHub connector GAGAL 2x: `POST https://api.github.com/user/repos: 403 Resource not accessible by integration` (akun lycann666 terautentikasi, status connected). Dugaan: instalasi GitHub App tak punya izin membuat repo baru. Perlu user buatkan repo publik kosong (atau tambah izin App), lalu lanjut push/bundle/check/submit. Kuota kompetisi saat itu: day left 5, can_submit true. TIDAK ada submit, kuota tak terpakai. Deadline 21:00 WIB 24 Nov 2026.
