# Yoga Bible App — Getting Started Guide

> A beginner-friendly, step-by-step guide to building your first React Native app.
> Each step marks whether YOU need to do it, or CLAUDE can do it for you.

---

## Prerequisites — What You Need on Your Computer

Before anything else, you need some software installed on your Mac or PC.

### Step 1: Install Node.js (if you don't have it)

**Who:** You (one-time setup on your machine)
**Claude can help?** I can guide you through it, but you need to run it on your machine.

You probably already have this from your yogabible.dk work. Check:
```bash
node --version    # Should show v18 or higher
npm --version     # Should show v9 or higher
```

If not installed: Download from https://nodejs.org (pick the LTS version).

---

### Step 2: Install Development Tools

**Who:** You (one-time setup)
**Claude can help?** I can give you exact commands, but you run them locally.

#### For Mac (recommended for iOS development):

```bash
# 1. Install Homebrew (Mac package manager) if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install Watchman (React Native needs this)
brew install watchman

# 3. Install Xcode from the Mac App Store
#    → Open App Store → Search "Xcode" → Install (it's free but ~12GB)
#    → After install, open Xcode once and accept the license agreement

# 4. Install Xcode command line tools
xcode-select --install

# 5. Install CocoaPods (iOS dependency manager)
sudo gem install cocoapods

# 6. Install Android Studio (for Android testing)
#    → Download from https://developer.android.com/studio
#    → During setup, make sure to install:
#      ✅ Android SDK
#      ✅ Android SDK Platform
#      ✅ Android Virtual Device (AVD)
```

#### For Windows/Linux (Android only — you need Mac for iOS):

```bash
# 1. Install Android Studio
#    → Download from https://developer.android.com/studio
#    → Install with Android SDK + AVD

# 2. Install Watchman
#    → Windows: choco install watchman (needs Chocolatey)
#    → Linux: brew install watchman (or build from source)
```

**Important:** To build iOS apps, you MUST have a Mac. There's no way around this. If you only have Windows/Linux, you can still build for Android and use a cloud service (EAS Build) for iOS builds.

---

### Step 3: Create a Mux Account

**Who:** You (account setup requires your business details)
**Claude can help?** No — this needs your email, payment info, and business details.

1. Go to https://mux.com
2. Click "Sign Up" → create account with your business email
3. After login, go to **Settings → API Access Tokens**
4. Click **"Generate new token"**
   - Name: `yoga-bible-app`
   - Permissions: Check ALL (Mux Video, Mux Data)
   - Click **Create Token**
5. **SAVE BOTH VALUES** — the Token ID and Token Secret
   - You only see the secret ONCE
   - Store them somewhere safe (password manager)
6. Go to **Settings → Signing Keys**
   - Click **Generate new key**
   - Save the Signing Key ID and Private Key (for DRM playback)

**Tip:** You likely already have a Mux account if the Namaste dev team set one up. Ask them! You can use the same Mux account for both apps — just create a separate environment or use the same one.

---

### Step 4: Verify Your Firebase Project

**Who:** You (check the Firebase console)
**Claude can help?** I can help you configure the app once you give me the config values.

Your Firebase project already exists (yogabible.dk uses it). You need to:

1. Go to https://console.firebase.google.com
2. Select your Yoga Bible project
3. Click the gear icon → **Project settings**
4. Scroll down to **"Your apps"**
5. If you only see a Web app, you need to add:
   - Click **"Add app"** → select **iOS** (Apple icon)
     - Bundle ID: `dk.yogabible.app` (or your preferred bundle ID)
     - Register → Download `GoogleService-Info.plist`
   - Click **"Add app"** → select **Android**
     - Package name: `dk.yogabible.app`
     - Register → Download `google-services.json`
6. Keep both files — you'll put them in the app later

---

### Step 5: Create the New Git Repository

**Who:** You (or Claude can do it from the terminal)
**Claude can help?** YES — I can create the repo structure and all initial files.

```bash
# Create the project directory (alongside your website repo)
mkdir ~/yogabible-app
cd ~/yogabible-app
git init
```

Or create it on GitHub first:
1. Go to https://github.com/new
2. Repository name: `yogabible-app`
3. Private: Yes
4. Create → then clone locally

---

### Step 6: Initialize the React Native Project

**Who:** You run the command, but Claude writes the config
**Claude can help?** YES — I can generate the entire project scaffold.

```bash
# Option A: Expo (easier for beginners — RECOMMENDED)
npx create-expo-app YogaBibleApp --template blank-typescript

# Option B: Bare React Native (more control, more setup)
npx @react-native-community/cli init YogaBibleApp --template react-native-template-typescript
```

**Why Expo is recommended for you:**
- Easier setup (no Xcode/Android Studio config headaches)
- `expo start` and scan QR code on your phone → instant preview
- EAS Build handles App Store / Play Store builds in the cloud
- You can always "eject" to bare React Native later if needed
- Mux player works with Expo
- Firebase works with Expo

After creation:
```bash
cd YogaBibleApp
npx expo start
```

Scan the QR code with your phone (install "Expo Go" app first) → you should see "Welcome to your app" on your phone. That's your first React Native app running!

---

### Step 7: Install Core Dependencies

**Who:** You run the commands (or Claude runs them)
**Claude can help?** YES — I can write the exact install commands and all config files.

```bash
# Firebase
npx expo install @react-native-firebase/app @react-native-firebase/auth @react-native-firebase/firestore

# Navigation (screen routing)
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack react-native-screens react-native-safe-area-context

# Mux Video Player
npx expo install @mux/mux-player-react-native

# Internationalization (Danish + English)
npx expo install react-i18next i18next

# Local storage
npx expo install @react-native-async-storage/async-storage

# Icons
npx expo install @expo/vector-icons
```

---

### Step 8: Set Up Project Structure

**Who:** Claude
**Claude can help?** YES — I will create this entire structure for you.

```
YogaBibleApp/
├── src/
│   ├── screens/           # One file per screen
│   │   ├── HomeScreen.tsx
│   │   ├── ScheduleScreen.tsx
│   │   ├── LibraryScreen.tsx
│   │   ├── CourseScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── LoginScreen.tsx
│   │   ├── RegisterScreen.tsx
│   │   ├── VideoPlayerScreen.tsx
│   │   └── ClassDetailScreen.tsx
│   ├── components/        # Reusable UI pieces
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── VideoCard.tsx
│   │   ├── ClassCard.tsx
│   │   └── Header.tsx
│   ├── services/          # API + backend connections
│   │   ├── firebase.ts        # Firebase init
│   │   ├── auth.ts            # Login, register, reset
│   │   ├── firestore.ts       # Profile, courses, videos
│   │   ├── mindbody.ts        # MindBody API calls
│   │   └── mux.ts             # Mux playback helpers
│   ├── hooks/             # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useProfile.ts
│   │   └── useVideos.ts
│   ├── i18n/              # Translations
│   │   ├── da.json            # Danish strings
│   │   └── en.json            # English strings
│   ├── theme/             # Design tokens
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   └── spacing.ts
│   └── navigation/        # Screen routing
│       └── AppNavigator.tsx
├── assets/                # Fonts, images
│   └── fonts/
│       └── AbacaxiLatin-Regular.ttf
├── app.json               # Expo config
├── tsconfig.json          # TypeScript config
└── package.json
```

---

### Step 9: Add Firebase Config Files

**Who:** You download the files, Claude wires them up
**Claude can help?** Partially — you download from Firebase console, I configure the code.

1. Place `GoogleService-Info.plist` in the `ios/` folder
2. Place `google-services.json` in the `android/app/` folder
3. Claude configures the Firebase initialization code in `src/services/firebase.ts`

---

### Step 10: Build Your First Screen

**Who:** Claude builds it, you review and test on your phone
**Claude can help?** YES — I will write all the screen code.

We start with the Login screen because:
- It tests Firebase Auth (your existing backend)
- It proves the app can talk to your services
- Every other screen needs auth anyway

```
You see on your phone:
┌────────────────────────┐
│                        │
│     YOGA BIBLE         │
│        [logo]          │
│                        │
│  ┌──────────────────┐  │
│  │ Email            │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ Password         │  │
│  └──────────────────┘  │
│                        │
│  ┌──────────────────┐  │
│  │   LOG IN         │  │
│  └──────────────────┘  │
│                        │
│  Forgot password?      │
│  Don't have an account?│
│  Sign up               │
│                        │
└────────────────────────┘
```

You log in with your existing yogabible.dk account — same Firebase, same user. If that works, the foundation is solid.

---

## Summary: What You Do vs. What Claude Does

| Step | Task | Who Does It |
|------|------|------------|
| 1 | Install Node.js | You (if not already installed) |
| 2 | Install Xcode + Android Studio | You (one-time, ~1 hour) |
| 3 | Create Mux account + get API keys | You (account setup) |
| 4 | Add iOS/Android apps to Firebase | You (Firebase console) |
| 5 | Create Git repo | Claude or You |
| 6 | Initialize React Native project | You run command, Claude configures |
| 7 | Install dependencies | Claude writes commands, you run them |
| 8 | Create project structure | Claude (100%) |
| 9 | Wire up Firebase config | You download files, Claude configures |
| 10 | Build first screen (Login) | Claude (100%) |
| 11 | Build Schedule screen | Claude (100%) |
| 12 | Build Video Library | Claude (100%) |
| 13 | Test on your phone | You (scan QR / run on device) |
| 14 | Submit to App Store | You (Apple Developer account needed) |
| 15 | Submit to Play Store | You (Google Play Console needed) |

---

## Accounts You Need (if you don't have them)

| Account | Cost | Why | URL |
|---------|------|-----|-----|
| **Apple Developer** | $99/year | Publish to App Store | https://developer.apple.com/programs/ |
| **Google Play Console** | $25 one-time | Publish to Play Store | https://play.google.com/console |
| **Mux** | Pay-as-you-go | Video hosting + streaming | https://mux.com |
| **Firebase** | Free tier (probably enough) | Auth + database | Already have |
| **GitHub** | Free | Code hosting | Already have |
| **Expo** | Free tier | Build service + app preview | https://expo.dev |

---

## Quick Terminology Cheat Sheet

If you're new to mobile development, here are terms you'll encounter:

| Term | What It Means |
|------|--------------|
| **React Native** | Framework to build mobile apps using JavaScript/TypeScript |
| **Expo** | Toolkit that makes React Native easier (handles builds, previews) |
| **TypeScript** | JavaScript with types (helps catch errors, autocomplete) |
| **Component** | A reusable piece of UI (like a button or card) |
| **Screen** | A full page in the app (like Login screen, Home screen) |
| **Navigation** | How users move between screens (tabs, back button) |
| **Hook** | A function that lets components use features like state or data |
| **Props** | Data passed from a parent component to a child |
| **State** | Data that changes over time (like "is user logged in?") |
| **SDK** | Software Development Kit — a package of tools to use a service |
| **HLS** | HTTP Live Streaming — how Mux delivers video |
| **DRM** | Digital Rights Management — prevents video piracy |
| **Bundle ID** | Unique app identifier for iOS (like dk.yogabible.app) |
| **Package Name** | Unique app identifier for Android (like dk.yogabible.app) |
| **APK / AAB** | Android app file formats (AAB is for Play Store) |
| **IPA** | iOS app file format (for App Store) |
| **EAS Build** | Expo's cloud build service (builds your app without local setup) |
| **QR Code preview** | Expo lets you scan a QR code to see your app live on your phone |
| **Hot Reload** | Change code → see changes instantly on your phone (no rebuild) |

---

## What's Next?

Once you have Steps 1-4 done (tools installed, Mux account, Firebase configured), message Claude and say:

> "Let's start building the Yoga Bible app. I have Node, Xcode, Mux API keys, and Firebase configured. Let's initialize the project and build the login screen."

Claude will take it from there — creating the project, installing dependencies, writing all the screens, and helping you test it on your phone.

---

## Common Gotchas for Beginners

1. **"Command not found: npx"** → You need to install Node.js (Step 1)
2. **"Xcode build failed"** → Make sure you opened Xcode once and accepted the license
3. **"No Android device found"** → Open Android Studio → AVD Manager → Create + Start an emulator
4. **"Firebase: No app created"** → Check GoogleService-Info.plist is in the right folder
5. **"Mux video not playing"** → Check playback ID, not asset ID (they're different)
6. **Metro bundler won't start** → Kill other terminals, run `npx expo start --clear`
7. **Expo Go can't connect** → Make sure phone and computer are on the same WiFi network

---

## Estimated Timeline

We're not going to predict exact dates, but here's the general order of work:

**Foundation (first sessions):**
- Project setup + Firebase connection
- Auth screens (login, register, reset)
- Profile screen

**Core features (next sessions):**
- Schedule + booking screens
- Video library + Mux player
- Course viewer

**Polish + Release:**
- Push notifications
- Offline support
- App Store + Play Store submission
- TV app variant
