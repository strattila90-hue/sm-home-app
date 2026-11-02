# SM home dekor Planner

Telepíthető webapp (PWA) az SM home dekor makramé vállalkozáshoz:
napi rendelésnapló, kiadások, havi és éves haszon, vállalkozási adatok
dokumentumtárral, NAV bevételi kimutatás a lezárt rendelésekből, és fényképes
árukészlet automatikus színfelismeréssel.

- **Felhős mentés:** Supabase (ingyenes csomag elég). Belépés e-mail + jelszóval,
  az adatok minden eszközön ugyanazok.
- **Offline is működik:** a módosítások a telefonon mentődnek, és amint van net,
  maguktól feltöltődnek.
- **Helyi mód:** ha a `config.js` üres, az app felhő nélkül fut (minden adat csak
  az adott telefonon). Kipróbálásra jó.

## Fájlok

| Fájl | Mi ez |
|---|---|
| `index.html` | Az app felülete és kinézete |
| `app.js` | Az app működése (számítások, szinkron, kimutatás) |
| `config.js` | **Ide kerül a Supabase címe és kulcsa** |
| `sw.js` | Offline működés |
| `manifest.webmanifest`, `*.png` | Telepítés, ikonok |
| `schema.sql` | Az adatbázis létrehozása (egyszer kell lefuttatni) |
| `vercel.json` | Vercel beállítások |

Nincs build lépés, sima statikus oldal.

---

## 1. Supabase beállítása (kb. 10 perc)

1. Regisztrálj a **supabase.com** oldalon, majd **New project**.
   Név: `sm-home-dekor`, régió: **Central EU (Frankfurt)**. Az adatbázis jelszót írd fel.
2. Bal oldalt **SQL Editor → New query**. Másold be a `schema.sql` teljes tartalmát, majd **Run**.
   Ez létrehozza az adattáblát, a privát dokumentumtárat és a jogosultságokat
   (mindenki csak a saját adatait látja).
3. **Project Settings → API** (újabb felületen: **Data API** / **API Keys**):
   másold ki a **Project URL**-t és az **anon / publishable** kulcsot.
   (A `service_role` / secret kulcsot **soha** ne tedd az appba.)
4. Írd be őket a `config.js`-be:
   ```js
   window.SMHD_CONFIG = {
     supabaseUrl: "https://abcdefghijkl.supabase.co",
     supabaseAnonKey: "eyJhbGciOi..."
   };
   ```

## 2. GitHub + Vercel

1. GitHubon új repó (pl. `sm-home-dekor-planner`), töltsd fel az összes fájlt a mappaszerkezettel együtt.
2. **vercel.com → Add New → Project →** válaszd a repót.
   Framework Preset: **Other**, Build Command: üres, Output Directory: üres → **Deploy**.
3. Megkapod a címet, pl. `https://sm-home-dekor-planner.vercel.app`.

## 3. A Vercel-cím megadása a Supabase-ben

Hogy a megerősítő és jelszó-visszaállító e-mailek linkjei az appra mutassanak:

**Authentication → URL Configuration**
- **Site URL:** a Vercel-cím (pl. `https://sm-home-dekor-planner.vercel.app`)
- **Redirect URLs:** ugyanez a cím, és mögé `/**`

Opcionális: **Authentication → Sign In / Providers → Email** alatt a „Confirm email”
kikapcsolható, ha nem akarsz megerősítő levelet. Bekapcsolva biztonságosabb.

## 4. Első indítás és telepítés

1. Nyisd meg a Vercel-címet, válaszd az **Új fiók** lehetőséget, és regisztrálj
   (a vállalkozás e-mail címével). Ha kell, erősítsd meg az e-mailben.
2. **Beállítások (jobb felső ikon) → Telepítés telefonra:** itt van a **QR-kód**.
   A feleséged a kamerájával beolvassa, majd:
   - **Android (Chrome):** menü ⋮ → *Alkalmazás telepítése* / *Hozzáadás a kezdőképernyőhöz*
   - **iPhone (Safari):** Megosztás gomb → *Főképernyőhöz adás*
3. Ugyanazzal az e-mail/jelszóval belépve te is látod a gépedről vagy a telefonodról.

## Korábbi adatok átvétele (a Claude-os verzióból)

A régi appban: **Beállítások → Biztonsági mentés (JSON)**. Az új appban:
**Beállítások → Mentés visszatöltése**, és válaszd ki a fájlt.

## Menü (2.5)

Alsó sor: **Főoldal · Naptár · ＋ Új · Árukészlet · Menü**.
- A középső **＋** gomb megkérdezi, mit rögzítesz: új rendelés, új kiadás, termékfotó
  a kamerával vagy fotók a galériából.
- A **Menü** csoportokba rendezve tartalmazza a többit (Kiadások, NAV kimutatás,
  Alapanyagok, Cég adatai, Beállítások, Motiváció, Rajztábla). Minden aloldal tetején
  „‹ Menü” vissza gomb van.

## Árukészlet (fényképes, 2.6)

- **Fotó készítése** (kamera) vagy **Galériából** (egyszerre több kép is, ajánlott max. 5–6).
- **Polc nézet:** soronként 3–4 termék egymás mellett, fapolcon. Felül színsáv (vagy ABC-ben
  betűsáv): egy színre koppintva a polc oda ugrik. **Rács nézet:** sűrű fotórács színcsoportonként.
- **Makramé színadatbázis:** 56 zsinórszín (natúr/ekrü, krém, bézs, terrakotta, rozsda, mustár,
  okker, zsálya, eukaliptusz, olíva, petrol, púder, mályva, levendula, antracit…) 15 színcsoportban.
  Az app a fotóról kiszűri a hátteret, és a legközelebbi zsinórszínt választja (Lab színtávolság).
  A szín a színkörökből egy koppintással javítható.
- **Makramé termékadatbázis:** 31 terméktípus (falikárpit, növénytartó, lámpabúra, tükörkeret,
  fülbevaló, karkötő, táska, álomfogó, alátét, ünnepi díszek…). A típusból és a színből automatikus
  név készül (pl. „Terrakotta falikárpit”), és a típus alapján kategóriát javasol.
- **Okos termékfelismerés (opcionális):** bekapcsolva a fotóról felismeri a terméktípust (CLIP modell,
  a telefonon fut, egyszeri kb. 150 MB letöltés, Wi-Fi ajánlott). Beállítások → Árukészlet.
- **Hibamagyarázat:** ha egy fotó nem tölthető be vagy fel, az app megírja, mi a hiba és mit tehetsz
  (HEIC formátum, sérült vagy felhőben lévő kép, kevés memória, nincs net, lejárt belépés,
  hiányzó Supabase jogosultság vagy tárhely, méretkorlát). Az utolsó 30 hiba a
  **Beállítások → Árukészlet → Hibanapló** alatt visszanézhető.
- HEIC képeket az app megpróbálja automatikusan JPEG-re alakítani.
- Internet nélkül is lehet fotózni: a kép a telefonon marad, és a következő szinkronnál
  feltöltődik (vagy „Feltöltés most” gomb).
- **Adatbázis-módosítás nem kell:** a meglévő `schema.sql` változatlanul jó.

## Hogyan működik a NAV kimutatás

- A **„Teljesítve”** állapotú rendelések kerülnek bele, a **kifizetés napja** szerint időrendben.
- Rendelésnél a „Lezárás és bizonylat” részben add meg a **számla / nyugta sorszámát**
  és a **fizetés módját**. A hiányzó sorszámra a kimutatás figyelmeztet.
- Időszak: egész év, negyedév vagy hónap. **Nyomtatás / PDF** gomb (a telefon nyomtatási
  menüjében „Mentés PDF-ként”), vagy **CSV** a könyvelőnek.
- Alanyi adómentesként a bevétel áfa nélkül szerepel. ÁFA-körös beállításnál a bruttó
  árból 27%-kal visszaszámolja a nettót és az ÁFÁ-t.
- A kimutatás nyilvántartás, nem bevallás: a bevallást továbbra is a könyvelő vagy az
  ügyfélkapu+ / ONYA felület intézi.

## Tudnivalók

- **Ingyenes Supabase:** ha a projektet kb. egy hétig senki nem használja, a Supabase
  szünetelteti. Napi használat mellett ez nem fordul elő. Ha mégis, a Supabase
  felületén egy gombbal visszaállítható, adatvesztés nélkül.
- **Biztonsági mentés:** havonta érdemes letölteni a JSON mentést (Beállítások).
- **Frissítés:** ha módosítasz egy fájlt és feltöltöd GitHubra, a Vercel automatikusan
  kiteszi. Az app a következő megnyitáskor frissül (néha két megnyitás kell).
  Nagyobb változásnál növeld a `sw.js` elején a `CACHE` verziószámát.
- **Dokumentumok:** a feltöltött fotók és PDF-ek privát tárhelyre kerülnek, a nagy
  fotókat az app feltöltés előtt kicsinyíti. Fájlonként max. 20 MB.
