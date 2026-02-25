# PRD — Alba3ati (البعاتي) Mobile App

## 1. Product Overview

**Alba3ati** is a real-time multiplayer social deduction game based on a traditional Sudanese variant of Mafia/Werewolf. Players join rooms, get assigned secret roles, and compete in night/day cycles using voice chat and voting to determine the survivors.

**Platform:** React Native (Expo SDK 52+)
**Language:** Arabic (RTL layout throughout the entire app)
**Visual Style:** Cartoonish, animated, game-like — vibrant colors, hand-drawn/illustrated feel, character illustrations, playful typography, micro-animations on every interaction. Think "Among Us meets a Sudanese folk-art storybook."
**Target:** iOS & Android

---

## 2. Design Language & Visual Identity

### 2.1 Art Direction

- **Palette:** Warm earth tones (sand, terracotta, deep indigo) contrasted with vivid accent colors per role (see Section 6)
- **Typography:** Bold rounded Arabic typeface (e.g., Cairo, Tajawal, or a custom hand-lettered font). Large, legible, playful
- **Illustrations:** Every role has a unique full-body cartoon character illustration. All characters wear traditional Sudanese-inspired attire with exaggerated cartoonish proportions
- **Backgrounds:** Illustrated village scenes — night sky with stars for night phase, bright sunny village for day phase
- **UI Elements:** Rounded corners everywhere, soft shadows, subtle paper/grain texture overlays. Buttons look like wooden signs or clay tablets
- **Animations:** Lottie/Reanimated throughout — screen transitions use page-flip or sand-swirl effects, buttons bounce on press, role reveal uses a card-flip animation, death uses a dramatic smoke-poof, timer is an animated hourglass

### 2.2 RTL Requirements

- All layouts use `I18nManager.forceRTL(true)` and `flexDirection: 'row-reverse'` where needed
- Navigation drawer opens from the right
- All text alignment is right-to-left
- Swipe gestures are mirrored (swipe right = back)
- Icons that imply direction (arrows, chevrons) are flipped

### 2.3 Image Placeholders

Throughout this document, `[IMG: description]` denotes where illustration/image assets are required. These should be commissioned or generated as cartoonish vector illustrations.

---

## 3. Tech Stack

| Layer            | Technology                                                    |
| ---------------- | ------------------------------------------------------------- |
| Framework        | React Native + Expo SDK 52+                                   |
| Navigation       | Expo Router (file-based)                                      |
| State Management | Zustand                                                       |
| Real-time        | socket.io-client                                              |
| Voice Chat       | WebRTC (react-native-webrtc or expo-av for audio)             |
| Animations       | react-native-reanimated + lottie-react-native                 |
| Styling          | NativeWind (Tailwind for RN) or StyleSheet with design tokens |
| HTTP Client      | Axios or fetch                                                |
| Storage          | expo-secure-store (user ID persistence)                       |
| Audio/SFX        | expo-av                                                       |

---

## 4. Screen Map & Navigation Structure

```
app/
├── (auth)/
│   └── register.tsx           — Name entry / login
├── (main)/
│   ├── index.tsx              — Home (hub)
│   ├── join-room.tsx          — Join room by code
│   ├── public-rooms.tsx       — Browse public rooms
│   └── settings.tsx           — App settings
├── (game)/
│   ├── lobby.tsx              — Room lobby (waiting room)
│   ├── role-setup.tsx         — Host: role distribution config
│   ├── role-reveal.tsx        — Player sees their assigned role
│   ├── night.tsx              — Night phase (role-specific action)
│   ├── night-results.tsx      — Morning announcement (who died)
│   ├── discussion.tsx         — Day discussion with voice & timer
│   ├── voting.tsx             — Day vote on who to eliminate
│   ├── vote-results.tsx       — Vote outcome reveal
│   └── game-over.tsx          — End screen (winner announcement)
└── _layout.tsx                — Root layout with RTL config
```

---

## 5. Screens — Detailed Specifications

### 5.1 Register Screen (`register.tsx`)

**Purpose:** Create a player identity. This is the first screen new users see.

**Layout:**

```
┌──────────────────────────────┐
│   [IMG: Game logo - stylized │
│    Arabic calligraphy of     │
│    "البعاتي" with cartoon    │
│    character silhouettes]    │
│                              │
│   ┌────────────────────────┐ │
│   │  أدخل اسمك             │ │
│   │  ________________      │ │
│   └────────────────────────┘ │
│                              │
│   ┌────────────────────────┐ │
│   │      ▶  ابدأ اللعب     │ │
│   └────────────────────────┘ │
│                              │
│   [IMG: Illustrated village  │
│    silhouette at bottom]     │
└──────────────────────────────┘
```

**Behavior:**

- Single text input for player name (Arabic placeholder: "أدخل اسمك")
- On submit: `POST /api/auth/register` with `{ name }`
- Store returned `user.id` and `user.name` in `expo-secure-store` for session persistence
- If stored user ID exists on app launch, skip this screen
- Button animation: bounces on press, ripple effect
- Background: subtle parallax animated village scene

**Validation:**

- Name required, min 2 characters
- Show inline error in red below input: "الاسم مطلوب" / "الاسم قصير جداً"

---

### 5.2 Home Screen (`index.tsx`)

**Purpose:** Central hub for all actions.

**Layout:**

```
┌──────────────────────────────┐
│  مرحباً، [اسم اللاعب]!  ☰  │
│                              │
│  [IMG: Main character mascot │
│   waving, animated idle]     │
│                              │
│  ┌────────────────────────┐  │
│  │  🏠  إنشاء غرفة        │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  🚪  انضم بكود          │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  🌐  الغرف العامة       │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  ⚙️  الإعدادات          │  │
│  └────────────────────────┘  │
│                              │
│  [IMG: Decorative village    │
│   bottom border]             │
└──────────────────────────────┘
```

**Behavior:**

- Greeting uses stored player name
- "إنشاء غرفة" (Create Room): emits `createRoom` socket event with user ID → navigates to lobby on `roomCreated` response
- "انضم بكود" (Join by Code): navigates to join-room screen
- "الغرف العامة" (Public Rooms): navigates to public-rooms screen
- "الإعدادات" (Settings): navigates to settings screen
- Establish socket connection on this screen (maintain throughout session)
- Animated mascot character has idle breathing/blinking animation (Lottie)
- Buttons use staggered entrance animation (slide in from right, one after another)

---

### 5.3 Join Room Screen (`join-room.tsx`)

**Purpose:** Enter a room code to join a private game.

**Layout:**

```
┌──────────────────────────────┐
│  →                أدخل الكود │
│                              │
│  [IMG: Cartoon door with     │
│   keyhole, animated glow]    │
│                              │
│   ┌──┬──┬──┬──┬──┬──┬──┐    │
│   │  │  │  │  │  │  │  │    │
│   └──┴──┴──┴──┴──┴──┴──┘    │
│       7-character code       │
│                              │
│   ┌────────────────────────┐ │
│   │      انضم للغرفة       │ │
│   └────────────────────────┘ │
│                              │
│   Error message area         │
└──────────────────────────────┘
```

**Behavior:**

- 7-character alphanumeric input (matching backend room ID format), shown as individual character boxes
- On submit: emit `joinRoom` socket event with `{ roomId, player: userId }`
- Listen for `roomJoined` → navigate to lobby
- Listen for `joinError` → show error message with shake animation:
  - "الغرفة غير موجودة" (Room not found)
  - "الغرفة ممتلئة" (Room is full)
- Auto-uppercase input, only allow `[a-z0-9]`

---

### 5.4 Public Rooms Screen (`public-rooms.tsx`)

**Purpose:** Browse and join public waiting rooms.

**Layout:**

```
┌──────────────────────────────┐
│  →              الغرف العامة  │
│                              │
│  ┌────────────────────────┐  │
│  │ غرفة أحمد    4/15  ◀── │  │
│  │ [IMG: tiny room icon]  │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ غرفة سارة    7/15  ◀── │  │
│  │ [IMG: tiny room icon]  │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ غرفة محمد    2/15  ◀── │  │
│  │ [IMG: tiny room icon]  │  │
│  └────────────────────────┘  │
│                              │
│  (Pull to refresh)           │
└──────────────────────────────┘
```

**Behavior:**

- Fetch rooms via `GET /api/rooms` on mount
- Listen for `roomsUpdate` socket event for real-time updates
- Each card shows: host name (from populated player), player count `(current/15)`
- Tap a room → emit `joinRoom` socket event → navigate to lobby on `roomJoined`
- Pull-to-refresh triggers fresh API call
- Empty state: illustrated tumbleweed animation with text "لا توجد غرف متاحة حالياً"
- Room cards animate in with staggered fade-up

---

### 5.5 Lobby Screen (`lobby.tsx`)

**Purpose:** Waiting room before game starts. Host configures the game here.

**Layout:**

```
┌──────────────────────────────┐
│  كود الغرفة: abc1234  [نسخ] │
│  ┌─────────────────────────┐ │
│  │  عام ○ / خاص ●          │ │
│  └─────────────────────────┘ │
│                              │
│  اللاعبون (4/15):           │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐       │
│  │👤│ │👤│ │👤│ │👤│       │
│  │أح│ │سا│ │مح│ │عل│       │
│  └──┘ └──┘ └──┘ └──┘       │
│  [IMG: Each player as a     │
│   cartoon avatar in a       │
│   circle, animated bounce   │
│   on join]                   │
│                              │
│  --- HOST ONLY BELOW ---    │
│  ┌────────────────────────┐ │
│  │   ⚙️ إعداد الأدوار      │ │
│  └────────────────────────┘ │
│  ┌────────────────────────┐ │
│  │   ▶  ابدأ اللعبة       │ │
│  └────────────────────────┘ │
└──────────────────────────────┘
```

**Behavior:**

- Display room code prominently with a copy-to-clipboard button
- Public/Private toggle (host only): emits `publicRoom` socket event with `{ roomId, isPublic }`
- Player grid: shows all players with cartoon avatar placeholders and names. New players pop in with a bounce animation
- Listen for `playerJoined` → update player list with animation
- **Host only** sees:
  - "إعداد الأدوار" button → navigates to role-setup screen
  - "ابدأ اللعبة" button → emits `startGame` socket event with `{ roomId }`
- Listen for `startGameError` → show toast "عدد اللاعبين غير كافي" (need more than 1 player)
- Listen for `gameStarted` → navigate host to role-setup
- Non-host players see a waiting state: "في انتظار بدء اللعبة..." with animated hourglass
- On `rolesAssigned` event → all players navigate to role-reveal
- Back/leave: emit `home` socket event, navigate to home screen

**Player Avatar Placeholders:**

- `[IMG: Default avatar — cartoon character silhouette in a circle, warm sand color]`
- Each player slot should have a subtle idle wobble animation

---

### 5.6 Role Setup Screen (`role-setup.tsx`) — HOST ONLY

**Purpose:** The host configures how many of each role to assign before starting.

**Layout:**

```
┌──────────────────────────────┐
│          توزيع الأدوار       │
│                              │
│  عدد اللاعبين: 7            │
│  ──────────────────────────  │
│                              │
│  ┌────────────────────────┐  │
│  │ [IMG: البعاتي cartoon] │  │
│  │  البعاتي               │  │
│  │  [-]  2  [+]           │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [IMG: العمدة cartoon]  │  │
│  │  العمدة                │  │
│  │  [-]  1  [+]           │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [IMG: شيخ الدمازين]    │  │
│  │  شيخ الدمازين          │  │
│  │  [-]  1  [+]           │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [IMG: ست الودع]        │  │
│  │  ست الودع              │  │
│  │  [-]  1  [+]           │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [IMG: ابو جنزير]       │  │
│  │  ابو جنزير             │  │
│  │  [-]  1  [+]           │  │
│  └────────────────────────┘  │
│                              │
│  المتبقي بدون دور: 1        │
│                              │
│  وقت النقاش:                │
│  [-]  3 دقائق  [+]         │
│                              │
│  ┌────────────────────────┐  │
│  │    ✓  وزّع الأدوار      │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Behavior:**

- Shows all 5 roles with their illustrations, names, and color accents
- Each role has increment/decrement buttons (min 0)
- Display remaining unassigned player count: `totalPlayers - sumOfRoles`
- **Validation:** Total assigned roles must equal total players. If not, disable the distribute button and show: "عدد الأدوار لا يتطابق مع عدد اللاعبين"
- Discussion time selector: minutes (min 1, max 10), sent as `discussionTime` parameter
- On "وزّع الأدوار" press: emit `assignRoles` socket event:
  ```json
  {
    "roomId": "abc1234",
    "distribution": { "1": 2, "2": 1, "3": 1, "4": 1, "5": 1 },
    "discussionTime": 3
  }
  ```
  Where keys are role IDs and values are counts
- Listen for `assignmentError` → show error toast

**Role Cards:**

- Each card has the role's accent color as a border/glow
- `[IMG: Full cartoon character illustration for each role, approximately 80x80px]`
- Counter animates (number scales up/down) on change

---

### 5.7 Role Reveal Screen (`role-reveal.tsx`)

**Purpose:** Each player privately sees their assigned role with a dramatic reveal animation.

**Layout:**

```
┌──────────────────────────────┐
│                              │
│         دورك هو...          │
│                              │
│   ┌──────────────────────┐   │
│   │                      │   │
│   │  [IMG: Card back     │   │
│   │   with ornate        │   │
│   │   pattern, flips     │   │
│   │   to reveal role]    │   │
│   │                      │   │
│   │    البعاتي            │   │
│   │                      │   │
│   │  [IMG: Full-size     │   │
│   │   role character     │   │
│   │   illustration]      │   │
│   │                      │   │
│   │  "مهمتك: القضاء على  │   │
│   │   أهل القرية دون     │   │
│   │   أن يكتشفوك"        │   │
│   │                      │   │
│   └──────────────────────┘   │
│                              │
│   ┌────────────────────────┐ │
│   │      ▶  فهمت!         │ │
│   └────────────────────────┘ │
│                              │
│   [IMG: Night sky bg with    │
│    animated twinkling stars] │
└──────────────────────────────┘
```

**Behavior:**

- Data comes from `rolesAssigned` socket event. Find current player's `roleId` in the room's players array
- Card starts face-down with ornate back pattern, then flips (3D Y-axis rotation animation, ~1 second) to reveal the role
- Role accent color glows behind the card
- Particle/sparkle effect on reveal
- Role description text (see Section 6 for per-role descriptions)
- "فهمت!" (Got it!) button → navigate to night phase screen
- Night sky background with parallax star field animation
- Sound effect: dramatic reveal whoosh + role-specific sound cue

**Role Card Assets Required:**

- `[IMG: Card back — ornate geometric Sudanese pattern, dark indigo with gold accents]`
- `[IMG: البعاتي card — large character illustration, role color #4A90E2]`
- `[IMG: العمدة card — large character illustration, role color #50E3C2]`
- `[IMG: شيخ الدمازين card — large character illustration, role color #E94F37]`
- `[IMG: ست الودع card — large character illustration, role color #8E44AD]`
- `[IMG: ابو جنزير card — large character illustration, role color #F1C40F]`

---

### 5.8 Night Phase Screen (`night.tsx`)

**Purpose:** Each role performs their night action by selecting a target player. This is the core gameplay screen.

**Layout (Common):**

```
┌──────────────────────────────┐
│  الليلة [N]        ⏳ [timer]│
│                              │
│  [IMG: Night sky background  │
│   with animated moon and     │
│   floating clouds]           │
│                              │
│  ┌────────────────────────┐  │
│  │  [Role-specific        │  │
│  │   instruction text]    │  │
│  └────────────────────────┘  │
│                              │
│  اختر هدفك:                 │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐       │
│  │👤│ │👤│ │💀│ │👤│       │
│  │أح│ │سا│ │مح│ │عل│       │
│  └──┘ └──┘ └──┘ └──┘       │
│  (Dead players grayed out)  │
│                              │
│  ┌────────────────────────┐  │
│  │      ✓  نفّذ            │  │
│  └────────────────────────┘  │
│                              │
│  [or waiting state if done] │
└──────────────────────────────┘
```

**Timer:**

- Server emits `tick` events with remaining seconds
- Display as animated hourglass + seconds countdown
- When `ROUND_TIME` (500 seconds / ~8.3 minutes) expires, server emits `timerEnd` → auto-resolve

**Per-Role Night Behavior:**

#### البعاتي (Ba3ati) — Role ID: "1"

- **Instruction:** "اختر من تريد القضاء عليه الليلة" (Choose who to eliminate tonight)
- **Action:** Select one alive player from the grid (cannot select self, cannot select dead players)
- **On confirm:** Emit `b3atiAction` with `{ roomId, targetId, playerId }`
- **Color theme:** Blue (#4A90E2) night overlay
- **Animation:** Selected target gets a crosshair/dagger animation overlay

#### العمدة (Al3omda) — Role ID: "2"

- **Instruction:** "اختر من تريد حمايته الليلة" (Choose who to protect tonight)
- **Action:** Select one alive player to protect (can select self or others)
- **On confirm:** Emit `al3omdaAction` with `{ roomId, targetId, playerId }`
- **Color theme:** Teal (#50E3C2) night overlay
- **Animation:** Selected target gets a shield glow animation

#### شيخ الدمازين (Damazeen Chief) — Role ID: "3"

- **Instruction:** "اختر: هل تريد القضاء على لاعب أم حماية الجميع؟" (Choose: eliminate a player or protect everyone?)
- **Action:** Two modes:
  - **Attack mode:** Select a target player → Emit `damazeenAction` with `{ roomId, targetId, playerId }`
  - **Protect mode:** Press a "حماية الجميع" (Protect All) button → Emit `damazeenProtection` with `{ roomId, playerId }`
- **Color theme:** Red (#E94F37) night overlay
- **UI:** Toggle switch or two-tab selector at the top: "هجوم" / "حماية"
- **Animation (Attack):** Selected target gets a flame animation
- **Animation (Protect):** Dome shield animation over all players

#### ست الودع (Sit Al-Wada3) — Role ID: "4"

- **Instruction:** "أنت في أمان الليلة. انتظر الصباح" (You are safe tonight. Wait for morning.)
- **Action:** No night action — passive role. Show waiting state
- **UI:** Display animated sleeping character illustration
- **Auto-resolve:** Player's `playStatus` is set to "done" automatically (the backend marks them done; the client just waits)
- Note: Based on backend code, this role has no dedicated action handler. The `resoveAction` check simply waits for all alive players to be "done." This role should emit a skip/pass action or the backend resolves when all active roles finish.

#### ابو جنزير (Abu Janzeer) — Role ID: "5"

- **Instruction:** "أنت في أمان الليلة. انتظر الصباح" (You are safe tonight. Wait for morning.)
- **Action:** No night action — passive role. Show waiting state
- **UI:** Display animated sleeping character illustration
- Same behavior as ست الودع

**Common Night Phase Behavior:**

- After submitting action, show waiting screen: "في انتظار اللاعبين الآخرين..." with animated dots and a list showing who has finished (✓) and who hasn't (⏳)
- Listen for `playerDone` → update the waiting list
- Listen for `waitRoom` → confirm action was accepted, show waiting state
- Dead players (status: "dead") shown as grayscale ghosts in the player grid, not selectable
- Listen for `timeout` → server resolved all night actions, prepare for results

---

### 5.9 Night Results Screen (`night-results.tsx`)

**Purpose:** Dramatic reveal of who died during the night.

**Layout:**

```
┌──────────────────────────────┐
│                              │
│  [IMG: Sunrise over village  │
│   animated transition from   │
│   night to dawn]             │
│                              │
│         أحداث الليلة         │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  [IMG: Dead player's   │  │
│  │   avatar with X eyes   │  │
│  │   and ghost effect]    │  │
│  │                        │  │
│  │   تم القضاء على: أحمد   │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  — أو —                      │
│                              │
│  ┌────────────────────────┐  │
│  │  لم يُقتل أحد الليلة!  │  │
│  │  [IMG: Village safe     │  │
│  │   celebration]          │  │
│  └────────────────────────┘  │
│                              │
│   (Auto-advance after 3s)   │
└──────────────────────────────┘
```

**Behavior:**

- Triggered by `timeout` socket event followed by the 3-second delay from server's `setTimeout`
- Compare players' `status` between previous state and updated room data — any player newly set to "dead" is announced
- If Al3omda protected the Ba3ati's target: "العمدة أنقذ أحد اللاعبين!" with shield animation
- If Damazeen protection was active (`damazeenProtection: true`): "شيخ الدمازين حمى الجميع!" — no Ba3ati kills this round
- If Damazeen attacked someone: show that death too
- Multiple deaths possible in one night (Ba3ati kill + Damazeen kill)
- Death animation: player avatar turns to ghost with smoke-poof effect + dramatic sound
- Safe night: celebratory confetti + relief sound
- Auto-transitions to discussion phase after ~3 seconds (matching server's `setTimeout(() => nightResults(...), 3000)`)

---

### 5.10 Discussion Phase Screen (`discussion.tsx`)

**Purpose:** Day phase where alive players discuss via voice chat and text before voting.

**Layout:**

```
┌──────────────────────────────┐
│  اليوم [N]     ⏳ [MM:SS]   │
│                              │
│  [IMG: Sunny village square  │
│   background, animated       │
│   bunting/flags]             │
│                              │
│  اللاعبون الأحياء:           │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐       │
│  │🔊│ │👤│ │👤│ │🔊│       │
│  │أح│ │سا│ │مح│ │عل│       │
│  └──┘ └──┘ └──┘ └──┘       │
│  (Speaking indicator on      │
│   active speakers)           │
│                              │
│  💀 الأموات:                 │
│  ┌──┐ ┌──┐                  │
│  │💀│ │💀│  (greyed out)    │
│  │خا│ │فا│                  │
│  └──┘ └──┘                  │
│                              │
│  ┌────────────────────────┐  │
│  │  🎤  [Mic Toggle]       │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  💬  Chat messages area  │  │
│  │  ________________________│  │
│  │  [Type message]   [ارسل]│  │
│  └────────────────────────┘  │
│                              │
│  (Timer counts down to vote) │
└──────────────────────────────┘
```

**Behavior:**

- Timer: `discussionTime` (configured by host, in seconds from server). Countdown displayed as `MM:SS`
- Listen for `tick` events → update timer display. Animated hourglass speeds up in last 30 seconds
- **Voice Chat (WebRTC):**
  - Mic toggle button (large, centered, animated pulse when active)
  - Emit `offer` / `answer` / `ice-candidate` events for WebRTC signaling
  - Emit `speaking-state` with `{ roomId, playerId, isSpeaking }` when mic is active
  - Listen for `speaking-update` → show animated sound wave indicator on speaking player's avatar
- **Text Chat:**
  - Uses the `/chat` Socket.IO namespace
  - Emit `joinRoom` on `/chat` namespace on mount
  - Emit `sendMessage` with `{ room: roomId, message, sender }` on `/chat` namespace
  - Listen for `newMessage` → append to chat list
  - Chat messages scroll from bottom, RTL aligned
- Dead players can spectate but cannot speak or vote
- When timer reaches 0: server emits `timerEnds` → auto-transition to voting phase
- Warning flash animation at 10 seconds remaining

---

### 5.11 Voting Screen (`voting.tsx`)

**Purpose:** Alive players vote on who to eliminate.

**Layout:**

```
┌──────────────────────────────┐
│  التصويت          ⏳ [timer] │
│                              │
│  [IMG: Dramatic sunset       │
│   village scene, torches     │
│   lit, animated flames]      │
│                              │
│  صوّت لإقصاء لاعب:          │
│                              │
│  ┌────────────────────────┐  │
│  │ 👤 أحمد          [صوّت]│  │
│  │    ██░░░░░ (2 votes)   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ 👤 سارة          [صوّت]│  │
│  │    ███████ (5 votes)   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ 👤 محمد          [صوّت]│  │
│  │    ░░░░░░░ (0 votes)   │  │
│  └────────────────────────┘  │
│                              │
│  صوّت ✓ / لم يصوّت ⏳        │
│  أحمد ✓  سارة ⏳  محمد ✓     │
└──────────────────────────────┘
```

**Behavior:**

- Only alive players can vote and be voted on
- Each alive player shown as a card with name, avatar, and "صوّت" (Vote) button
- On vote: emit `vote` with `{ roomId, targetId: selectedPlayerId, playerId: myId }`
- Vote is **one-shot** — once voted, button disables and shows "تم التصويت ✓"
- Listen for `playerVoted` → update vote progress (shows how many have voted via `playStatus` tracking, NOT revealing who voted for whom)
- Vote count bars: show real-time vote tallies (the `votes` array in room data contains target IDs, allowing counting)
- Dead players see the voting screen as spectators (no vote button)
- When all alive players have voted, server calls `claculateVoteResult` → emits `vote-res`
- Player cards have a subtle shake animation when receiving a vote

---

### 5.12 Vote Results Screen (`vote-results.tsx`)

**Purpose:** Reveal who was voted out (or if it was a tie).

**Layout — Elimination:**

```
┌──────────────────────────────┐
│                              │
│        نتيجة التصويت         │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  [IMG: Eliminated      │  │
│  │   player's avatar,     │  │
│  │   dramatic X overlay,  │  │
│  │   ghost float-away     │  │
│  │   animation]           │  │
│  │                        │  │
│  │   تم إقصاء: سارة       │  │
│  │   عدد الأصوات: 5        │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  (Auto-advance after 5s)    │
└──────────────────────────────┘
```

**Layout — Tie (No elimination):**

```
┌──────────────────────────────┐
│                              │
│        نتيجة التصويت         │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  [IMG: Scales of       │  │
│  │   justice, balanced,   │  │
│  │   swaying animation]   │  │
│  │                        │  │
│  │   تعادل! لم يُقصَ أحد  │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  (Auto-advance after 5s)    │
└──────────────────────────────┘
```

**Behavior:**

- Triggered by `vote-res` socket event with `{ room, eliminated }`
- If `eliminated` is not null: show eliminated player with dramatic death animation + gavel sound
- If `eliminated` is null (tie or no votes): show tie screen with balance scale animation
- After 5 seconds (matching server's `setTimeout(() => nightResults(..., true), 5000)`):
  - Server runs `nightResults` to check win conditions
  - Listen for `gameOver` → navigate to game-over screen
  - Listen for `nextNight` → navigate back to night phase (new round, `roundNumber` incremented)

---

### 5.13 Game Over Screen (`game-over.tsx`)

**Purpose:** Final results screen showing the winning team and all role reveals.

**Layout:**

```
┌──────────────────────────────┐
│                              │
│  [IMG: Victory banner with   │
│   confetti / fireworks       │
│   animation]                 │
│                              │
│        انتهت اللعبة!         │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  فاز فريق: [الأهالي/   │  │
│  │   البعاتي/تعادل]       │  │
│  │                        │  │
│  │  [IMG: Winning team     │  │
│  │   celebration           │  │
│  │   illustration]         │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  كشف الأدوار:               │
│  ┌────────────────────────┐  │
│  │ أحمد — البعاتي    💀  │  │
│  │ سارة — العمدة     🏆  │  │
│  │ محمد — شيخ الدمازين 💀 │  │
│  │ علي — ست الودع    🏆  │  │
│  │ خالد — ابو جنزير  🏆  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │   🏠  العودة للرئيسية   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │   🔄  العب مرة أخرى    │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Behavior:**

- Triggered by `gameOver` socket event with `{ room, win }`
- `win` values:
  - `"1"` — البعاتي (Ba3ati) team wins: "فاز فريق البعاتي!" — red/blue dramatic theme
  - `"2"` — Villagers win: "فاز الأهالي!" — green/gold celebration theme
  - `"0"` — Draw (everyone dead): "تعادل! لا فائز" — gray/muted theme
- **Role reveal table:** All players shown with their secret roles revealed, using role color accents. Dead players marked with 💀, survivors with 🏆
- Staggered role reveal animation: each row flips/fades in one by one (top to bottom)
- Winner announcement: large animated text with particle effects
- Background: confetti for villager win, dark dramatic scene for Ba3ati win, somber for draw
- Sound: victory fanfare / defeat theme / draw ambience
- "العودة للرئيسية" → emit `home` socket event, navigate to home
- "العب مرة أخرى" → emit `createRoom` if host, or navigate to home for others

---

### 5.14 Settings Screen (`settings.tsx`)

**Purpose:** App settings and player profile.

**Layout:**

```
┌──────────────────────────────┐
│  →                الإعدادات  │
│                              │
│  الملف الشخصي               │
│  ┌────────────────────────┐  │
│  │  الاسم: [text input]   │  │
│  └────────────────────────┘  │
│                              │
│  الصوت                      │
│  ┌────────────────────────┐  │
│  │  المؤثرات الصوتية  [●] │  │
│  │  الموسيقى         [●]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  تسجيل الخروج          │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Behavior:**

- Edit player name (saved to local storage, future: API update)
- Sound effects toggle (for game SFX)
- Music toggle (for background ambience)
- Logout: clears stored user data, returns to register screen

---

## 6. Game Roles — Complete Reference

### 6.1 البعاتي (Ba3ati) — The Killer

| Property      | Value                                            |
| ------------- | ------------------------------------------------ |
| Role ID       | `"1"`                                            |
| Color         | `#4A90E2` (Blue)                                 |
| Team          | البعاتي (Evil)                                   |
| Night Action  | Choose one player to kill                        |
| Socket Event  | `b3atiAction` → `{ roomId, targetId, playerId }` |
| Win Condition | Ba3ati count > villager count                    |

**Description shown to player:**
"أنت البعاتي. مهمتك القضاء على أهل القرية واحداً تلو الآخر دون أن يكشفك أحد. اختر ضحيتك كل ليلة بحكمة."

**Character illustration:**
`[IMG: Sinister cartoon character in dark blue cloak, mischievous grin, glowing eyes, holding a shadowy dagger. Sudanese headwrap (عمامة). Exaggerated sneaky posture.]`

**Multiple Ba3ati:** The host can assign more than one Ba3ati. Each Ba3ati independently selects a target. All targets in `ba3atiTargets` are killed unless protected.

---

### 6.2 العمدة (Al3omda) — The Protector

| Property      | Value                                              |
| ------------- | -------------------------------------------------- |
| Role ID       | `"2"`                                              |
| Color         | `#50E3C2` (Teal)                                   |
| Team          | الأهالي (Villagers)                                |
| Night Action  | Choose one player to protect from Ba3ati           |
| Socket Event  | `al3omdaAction` → `{ roomId, targetId, playerId }` |
| Win Condition | All Ba3ati eliminated                              |

**Description shown to player:**
"أنت العمدة، حامي القرية. كل ليلة يمكنك اختيار لاعب واحد لحمايته من البعاتي. اختر بحكمة!"

**Character illustration:**
`[IMG: Noble cartoon village chief in white robes and large turban (عمامة كبيرة), holding a glowing shield. Broad shoulders, kind but determined face. Teal glow aura.]`

**Protection mechanic:** If Al3omda's target matches a Ba3ati target, that player survives. Protection does NOT block Damazeen kills.

---

### 6.3 شيخ الدمازين (Damazeen Chief) — The Wild Card

| Property      | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Role ID       | `"3"`                                                                                                    |
| Color         | `#E94F37` (Red)                                                                                          |
| Team          | الأهالي (Villagers)                                                                                      |
| Night Action  | **Either** kill one player **OR** activate protection for all                                            |
| Socket Events | `damazeenAction` → `{ roomId, targetId, playerId }` **OR** `damazeenProtection` → `{ roomId, playerId }` |
| Win Condition | All Ba3ati eliminated                                                                                    |

**Description shown to player:**
"أنت شيخ الدمازين. لديك قوة خاصة: يمكنك إما القضاء على لاعب مشبوه، أو حماية الجميع من البعاتي لهذه الليلة. استخدم قوتك بحكمة!"

**Character illustration:**
`[IMG: Powerful cartoon tribal chief with ceremonial drums (دمازين drums) strapped to back, face paint, red flowing robes. Dual personality pose — one hand with flame, other with shield. Fierce expression.]`

**Protection mechanic (damazeenProtection):**

- When activated, sets `room.damazeenProtection = true`
- In `calculate.game.js`: if `damazeenProtection` is true, **ALL Ba3ati kills are blocked** for this night
- Damazeen kills (`damazeenTargets`) still happen even if Damazeen protection is active (different Damazeen players)
- This is a powerful ability — the UI should convey the weight of this choice

**Kill mechanic (damazeenAction):**

- Works like Ba3ati's kill but is NOT blocked by Al3omda's protection
- The target dies regardless of Al3omda's choice

---

### 6.4 ست الودع (Sit Al-Wada3) — The Seer

| Property      | Value                 |
| ------------- | --------------------- |
| Role ID       | `"4"`                 |
| Color         | `#8E44AD` (Purple)    |
| Team          | الأهالي (Villagers)   |
| Night Action  | None (passive)        |
| Socket Event  | None — auto-resolved  |
| Win Condition | All Ba3ati eliminated |

**Description shown to player:**
"أنتِ ست الودع. ليس لديكِ قدرة ليلية، لكن حدسكِ وذكاءكِ في النقاش هما سلاحكِ. ساعدي القرية في كشف البعاتي!"

**Character illustration:**
`[IMG: Wise cartoon woman in traditional Sudanese dress (ثوب سوداني) with cowrie shells (ودع) as jewelry/headpiece. Mysterious smile, purple aura, holding a decorative bowl of cowrie shells. Elegant and mystical.]`

**Night behavior:** This player sees the waiting/sleeping screen during night phase. They contribute during the day discussion and voting phases.

---

### 6.5 ابو جنزير (Abu Janzeer) — The Enforcer

| Property      | Value                   |
| ------------- | ----------------------- |
| Role ID       | `"5"`                   |
| Color         | `#F1C40F` (Gold/Yellow) |
| Team          | الأهالي (Villagers)     |
| Night Action  | None (passive)          |
| Socket Event  | None — auto-resolved    |
| Win Condition | All Ba3ati eliminated   |

**Description shown to player:**
"أنت ابو جنزير. ليس لديك قدرة ليلية، لكن قوتك في التأثير على الآخرين خلال النقاش. استخدم حجتك لإقناع القرية!"

**Character illustration:**
`[IMG: Tough cartoon character with a large chain (جنزير) wrapped around arm/shoulder, muscular build, gold/yellow vest, confident stance. Traditional Sudanese scarification marks on face. Intimidating but heroic.]`

**Night behavior:** Same as ست الودع — passive, waiting/sleeping screen during night.

---

## 7. Complete Game Flow State Machine

```
[LOBBY]
   │
   ├─ Host presses "ابدأ اللعبة" → emit startGame
   │   └─ Server validates (>1 player)
   │       ├─ Error → startGameError toast
   │       └─ OK → gameStarted event
   │
   ├─ Host configures roles → emit assignRoles
   │   └─ Server shuffles and assigns
   │       └─ rolesAssigned event → All players
   │
   ▼
[ROLE REVEAL]
   │
   ├─ Each player sees their role (card flip animation)
   ├─ Press "فهمت!" → enter night phase
   │
   ▼
[NIGHT PHASE] ◄─────────────────────────────────┐
   │                                              │
   ├─ Timer starts (ROUND_TIME = 500s)            │
   ├─ Active roles submit actions:                │
   │   ├─ البعاتي → b3atiAction                   │
   │   ├─ العمدة → al3omdaAction                   │
   │   ├─ شيخ الدمازين → damazeenAction            │
   │   │              OR damazeenProtection         │
   │   └─ ست الودع / ابو جنزير → wait (passive)    │
   │                                              │
   ├─ Each action → playerDone event              │
   ├─ All done OR timer expires                   │
   │   └─ Server runs claculateResult:            │
   │       ├─ Ba3ati targets killed               │
   │       │   (unless Al3omda protected           │
   │       │    OR damazeenProtection active)       │
   │       ├─ Damazeen targets killed              │
   │       │   (NOT blocked by Al3omda)             │
   │       └─ Emits timeout event                  │
   │                                              │
   ▼                                              │
[NIGHT RESULTS] (3s delay from server)            │
   │                                              │
   ├─ Show who died / who was saved               │
   ├─ Server checks win conditions:               │
   │   ├─ Ba3ati > Villagers → gameOver (win:"1") │
   │   ├─ Ba3ati = 0 → gameOver (win:"2")         │
   │   ├─ All dead → gameOver (win:"0")            │
   │   └─ Game continues:                         │
   │                                              │
   ▼                                              │
[DISCUSSION PHASE]                                │
   │                                              │
   ├─ Timer: discussionTime (configured by host)  │
   ├─ Voice chat (WebRTC) active                  │
   ├─ Text chat (/chat namespace) active          │
   ├─ Timer expires → server emits timerEnds      │
   │   └─ Auto-triggers claculateVoteResult       │
   │                                              │
   ▼                                              │
[VOTING PHASE]                                    │
   │                                              │
   ├─ Alive players select a target               │
   ├─ Each vote → playerVoted event               │
   ├─ All voted → server runs claculateVoteResult │
   │                                              │
   ▼                                              │
[VOTE RESULTS] (5s display)                       │
   │                                              │
   ├─ Elimination OR Tie                          │
   ├─ Server checks win conditions (nightResults) │
   │   ├─ Game over → gameOver event ──────────── ─┐
   │   └─ Continue → nextNight event ──────────── ─┘
   │       └─ roundNumber++                       │
   │           └───────────────────────────────── ┘
   │
   ▼
[GAME OVER]
   │
   ├─ Show winner (1=Ba3ati, 2=Villagers, 0=Draw)
   ├─ Reveal all roles
   └─ Return to home or play again
```

---

## 8. Socket.IO Event Reference (Client-Side)

### 8.1 Events the Client EMITS

| Event                | Payload                                                     | When                        |
| -------------------- | ----------------------------------------------------------- | --------------------------- |
| `createRoom`         | `hostUserId` (string)                                       | Home → Create room          |
| `joinRoom`           | `{ roomId, player: userId }`                                | Join room screen            |
| `publicRoom`         | `{ roomId, isPublic }`                                      | Lobby toggle                |
| `startGame`          | `{ roomId }`                                                | Host starts game            |
| `assignRoles`        | `{ roomId, distribution: {roleId: count}, discussionTime }` | Host distributes roles      |
| `b3atiAction`        | `{ roomId, targetId, playerId }`                            | Ba3ati night action         |
| `al3omdaAction`      | `{ roomId, targetId, playerId }`                            | Al3omda night action        |
| `damazeenAction`     | `{ roomId, targetId, playerId }`                            | Damazeen kill action        |
| `damazeenProtection` | `{ roomId, playerId }`                                      | Damazeen protect-all action |
| `vote`               | `{ roomId, targetId, playerId }`                            | Day vote                    |
| `home`               | —                                                           | Leave all rooms             |
| `offer`              | `{ roomId, offer, target }`                                 | WebRTC offer                |
| `answer`             | `{ roomId, answer, target }`                                | WebRTC answer               |
| `ice-candidate`      | `{ roomId, candidate, target }`                             | WebRTC ICE candidate        |
| `speaking-state`     | `{ roomId, playerId, isSpeaking }`                          | Voice activity              |

### 8.2 Events the Client LISTENS TO

| Event             | Payload                     | Handler                                    |
| ----------------- | --------------------------- | ------------------------------------------ |
| `roomCreated`     | `{ room }`                  | Navigate to lobby                          |
| `roomUpdated`     | `{ room }` or `room`        | Update lobby state                         |
| `roomsUpdate`     | `[rooms]`                   | Update public rooms list                   |
| `playerJoined`    | `room` (populated)          | Update lobby player list                   |
| `joinError`       | `{ message }`               | Show error on join screen                  |
| `roomNotFound`    | `{ message }`               | Show error toast                           |
| `startGameError`  | `{ message }`               | Show error toast in lobby                  |
| `gameStarted`     | —                           | Host → navigate to role setup              |
| `rolesAssigned`   | `{ room }`                  | All → navigate to role reveal              |
| `assignmentError` | `{ message }`               | Show error toast                           |
| `tick`            | `remainingSeconds` (number) | Update timer display                       |
| `timerEnd`        | `room`                      | Night timer expired                        |
| `playerDone`      | `room`                      | Update waiting list                        |
| `waitRoom`        | —                           | Confirm action, show waiting               |
| `timeout`         | `room`                      | Night resolved, show results               |
| `stopTimer`       | —                           | Stop timer display                         |
| `timerEnds`       | —                           | Discussion time up, go to vote             |
| `playerVoted`     | `room`                      | Update vote progress                       |
| `vote-res`        | `{ room, eliminated }`      | Show vote results                          |
| `nextNight`       | `room`                      | Advance to next night round                |
| `gameOver`        | `{ room, win }`             | Navigate to game over screen               |
| `offer`           | `{ offer, senderId }`       | Handle WebRTC offer                        |
| `answer`          | `{ answer }`                | Handle WebRTC answer                       |
| `ice-candidate`   | `{ candidate }`             | Handle ICE candidate                       |
| `speaking-update` | `{ playerId, isSpeaking }`  | Update speaking indicator                  |
| `newMessage`      | `{ room, message, sender }` | Append chat message (on `/chat` namespace) |

---

## 9. State Management (Zustand Stores)

### 9.1 `useAuthStore`

```
{
  userId: string | null
  userName: string | null
  isAuthenticated: boolean
  register(name) → POST /api/auth/register
  loadStoredUser() → read from secure store
  logout() → clear store
}
```

### 9.2 `useGameStore`

```
{
  socket: Socket | null
  chatSocket: Socket | null
  currentRoom: Room | null
  myRole: Role | null
  gamePhase: 'lobby' | 'roleReveal' | 'night' | 'nightResults' | 'discussion' | 'voting' | 'voteResults' | 'gameOver'
  timer: number
  isHost: boolean
  roundNumber: number
  gameResult: { win: '0' | '1' | '2' } | null

  // Actions
  connectSocket()
  disconnectSocket()
  createRoom()
  joinRoom(roomId)
  leaveRoom()
  togglePublic()
  startGame()
  assignRoles(distribution, discussionTime)
  submitNightAction(targetId)
  submitVote(targetId)
  submitDamazeenProtection()
}
```

### 9.3 `useSettingsStore`

```
{
  sfxEnabled: boolean
  musicEnabled: boolean
  toggleSfx()
  toggleMusic()
}
```

---

## 10. Sound & Music Design

| Moment                    | Sound                                  |
| ------------------------- | -------------------------------------- |
| App launch                | Short traditional drum beat            |
| Button press              | Soft wooden "click"                    |
| Room created/joined       | Door creak open                        |
| Player joins lobby        | Pop/plop sound                         |
| Game start                | Dramatic drum roll                     |
| Role reveal (card flip)   | Whoosh + role-specific stinger         |
| Night begins              | Owl hoot + crickets ambience           |
| Night action submitted    | Subtle confirmation chime              |
| Death announcement        | Dramatic gong + ghost whoosh           |
| Protection save           | Shield clang + sparkle                 |
| Discussion start          | Rooster crow + morning ambience        |
| Vote cast                 | Stamp/gavel sound                      |
| Elimination               | Heavy gavel slam                       |
| Tie vote                  | Balance scale clink                    |
| Game over — villagers win | Celebratory drums + ululation (زغاريد) |
| Game over — ba3ati win    | Dark sinister laugh + thunder          |
| Game over — draw          | Somber wind                            |
| Timer warning (10s left)  | Heartbeat acceleration                 |

---

## 11. Animation Specifications

| Animation            | Technology                    | Duration     | Notes                            |
| -------------------- | ----------------------------- | ------------ | -------------------------------- |
| Screen transitions   | Reanimated shared transitions | 300-500ms    | Sand-swirl or page-flip          |
| Button press         | Reanimated spring             | 150ms        | Scale to 0.95 then bounce back   |
| Role card flip       | Reanimated 3D rotateY         | 1000ms       | With sparkle particles           |
| Death poof           | Lottie                        | 1500ms       | Smoke cloud, then ghost float-up |
| Timer hourglass      | Lottie (looped)               | 2000ms/cycle | Sand flowing, speeds up at end   |
| Speaking indicator   | Reanimated                    | Continuous   | Sound wave bars animation        |
| Player join bounce   | Reanimated spring             | 400ms        | Scale from 0 to 1 with overshoot |
| Confetti (win)       | Lottie                        | 3000ms       | Full-screen celebration          |
| Night/Day transition | Reanimated + Lottie           | 2000ms       | Sky color shift + sun/moon swap  |
| Vote bar fill        | Reanimated layout animation   | 300ms        | Smooth width growth              |
| Chat message         | Reanimated FadeInRight        | 200ms        | Slide in from right (RTL)        |
| Idle mascot          | Lottie (looped)               | 4000ms/cycle | Breathing + blinking             |

---

## 12. Image Asset Manifest

All assets should be cartoonish vector illustrations (SVG preferred, PNG fallback at 2x/3x).

| Asset ID                 | Description                                                                    | Usage                    |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------ |
| `logo`                   | Game title "البعاتي" in stylized Arabic calligraphy with character silhouettes | Register, splash         |
| `mascot-idle`            | Main character mascot, waving, animated                                        | Home screen              |
| `village-day`            | Sunny Sudanese village background scene                                        | Discussion, home         |
| `village-night`          | Moonlit village with stars                                                     | Night phase, role reveal |
| `village-sunset`         | Dramatic sunset scene with torches                                             | Voting phase             |
| `village-silhouette`     | Village bottom border decoration                                               | Register, home           |
| `card-back`              | Ornate geometric pattern, indigo + gold                                        | Role reveal              |
| `role-ba3ati`            | البعاتي full character (see 6.1)                                               | Role cards, reveal       |
| `role-al3omda`           | العمدة full character (see 6.2)                                                | Role cards, reveal       |
| `role-damazeen`          | شيخ الدمازين full character (see 6.3)                                          | Role cards, reveal       |
| `role-sit-alwada3`       | ست الودع full character (see 6.4)                                              | Role cards, reveal       |
| `role-abu-janzeer`       | ابو جنزير full character (see 6.5)                                             | Role cards, reveal       |
| `role-ba3ati-thumb`      | البعاتي thumbnail (80x80)                                                      | Role setup, game over    |
| `role-al3omda-thumb`     | العمدة thumbnail (80x80)                                                       | Role setup, game over    |
| `role-damazeen-thumb`    | شيخ الدمازين thumbnail (80x80)                                                 | Role setup, game over    |
| `role-sit-alwada3-thumb` | ست الودع thumbnail (80x80)                                                     | Role setup, game over    |
| `role-abu-janzeer-thumb` | ابو جنزير thumbnail (80x80)                                                    | Role setup, game over    |
| `avatar-default`         | Generic player avatar placeholder (circle)                                     | All player grids         |
| `avatar-dead`            | Ghost version of avatar (X eyes, translucent)                                  | Dead player display      |
| `icon-shield`            | Shield icon for protection actions                                             | Al3omda action           |
| `icon-dagger`            | Dagger/crosshair for kill actions                                              | Ba3ati action            |
| `icon-flame`             | Flame icon for Damazeen attack                                                 | Damazeen action          |
| `icon-dome`              | Dome shield for Damazeen protection                                            | Damazeen protect-all     |
| `icon-sleeping`          | Sleeping character for passive roles                                           | Night waiting            |
| `scales-balance`         | Balanced scales for tie vote                                                   | Vote results             |
| `banner-victory`         | Decorative victory banner                                                      | Game over                |
| `tumbleweed`             | Rolling tumbleweed for empty states                                            | Public rooms empty       |
| `sunrise-scene`          | Dawn breaking over village                                                     | Night results            |
| `door-keyhole`           | Cartoon door with glowing keyhole                                              | Join room                |

---

## 13. Error States & Edge Cases

| Scenario                                     | Handling                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Socket disconnects mid-game                  | Show reconnection overlay with spinner. Auto-reconnect with exponential backoff. On reconnect, re-join room and fetch current state |
| Player closes app during night               | Server's `resoveAction` waits for remaining players or timer expires. Player sees catch-up state on return                          |
| Host leaves during lobby                     | Show "المضيف غادر الغرفة" message, navigate all players to home                                                                     |
| Room becomes empty (`activePlayers === 0`)   | Server sets `status: "ended"`, room disappears from public list                                                                     |
| All players of one team die simultaneously   | Server's `nightResults` handles: checks counts after all deaths processed                                                           |
| Player tries to join full room (15/15)       | `joinError` with "الغرفة ممتلئة" message                                                                                            |
| Player tries to join a game in progress      | Room status is "playing", should show "اللعبة بدأت بالفعل"                                                                          |
| Network timeout on API calls                 | Show retry button with "حدث خطأ، حاول مرة أخرى" message                                                                             |
| Role distribution doesn't match player count | Disable "وزّع الأدوار" button, show validation message                                                                              |
| Player tries to select dead player as target | Dead players are non-interactive (greyed out, no tap handler)                                                                       |
| Timer reaches 0 during night                 | Server auto-resolves all pending actions via `claculateResult`                                                                      |
| Double-tap on action button                  | Disable button after first tap, show loading state                                                                                  |

---

## 14. Performance Targets

| Metric                      | Target      |
| --------------------------- | ----------- |
| App launch to interactive   | < 2 seconds |
| Screen transition           | < 300ms     |
| Socket event → UI update    | < 100ms     |
| Animation frame rate        | 60 FPS      |
| Lottie animation frame rate | 60 FPS      |
| Memory usage (gameplay)     | < 150MB     |
| Bundle size (OTA)           | < 25MB      |
