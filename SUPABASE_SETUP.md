# Mpangilio wa Supabase (Godown Stock App)

Hatua chache za kuunganisha app na Supabase (database ya wingu/cloud).

## 1. Tengeneza project ya Supabase

1. Fungua https://supabase.com na ufanye akaunti (bure).
2. Bonyeza **New project**, chagua jina (mfano `godown-stock`) na nenosiri la database.
3. Subiri project ianze (dakika 1-2).

## 2. Weka schema ya database

1. Kwenye dashboard ya project, fungua **SQL Editor** (upande wa kushoto).
2. Bonyeza **New query**.
3. Fungua faili `supabase/schema.sql` kutoka project hii, nakili (copy) maudhui yote, bandika (paste) kwenye SQL Editor.
4. Bonyeza **Run**. Hii itatengeneza tables (`profiles`, `products`, `stock_movements`), triggers, na RLS policies zote.

## 3. (Hiari) Zima uthibitisho wa barua pepe kwa majaribio

Kwa default, Supabase inahitaji mtumiaji athibitishe barua pepe kabla ya kuingia. Kwa majaribio ya haraka:

1. Fungua **Authentication -> Providers -> Email**.
2. Zima (toggle off) **Confirm email**.
3. Hifadhi (Save).

(Unaweza kuwasha tena baadaye kwa matumizi halisi.)

## 4. Pata API keys na uziweke kwenye app

1. Fungua **Project Settings -> API**.
2. Nakili **Project URL** na **anon public key**.
3. Kwenye folda ya app, nakili `.env.example` kuwa `.env`:

   ```bash
   cp .env.example .env
   ```

4. Jaza thamani kwenye `.env`:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJ...
   ```

## 5. Anzisha app

```bash
bun run start
```

Kisha fungua app ya **Expo Go** kwenye simu yako na uskani QR code itakayoonekana kwenye terminal.

## 6. Fanya mtumiaji wa kwanza kuwa Admin

1. Kwenye app, **Jisajili** (Register) na akaunti yako.
2. Kwenye Supabase dashboard, fungua **SQL Editor** na ukimbie (run):

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'barua-pepe-yako@mfano.com');
   ```

3. Toka (logout) na ingia tena kwenye app - sasa una ruhusa za Admin (unaweza kufuta bidhaa na kusimamia watumiaji kwenye tab ya **Wasifu**).

## Muundo wa Roles

- **staff** (Mfanyakazi - default kwa watumiaji wapya): anaweza kuongeza/kuhariri bidhaa, kurekodi stock in/out, kuona ripoti.
- **admin**: vyote vya staff, pamoja na kufuta bidhaa, kufuta/kurekebisha mzunguko wa stock, na kubadilisha roles za watumiaji wengine (tab ya Wasifu -> Simamia Watumiaji).
