# Course Materials System — Setup Guide

## Firestore Data Model

### Collections

```
courses/{courseId}
  ├── title_da: string
  ├── title_en: string
  ├── description_da: string
  ├── description_en: string
  ├── thumbnail: string (URL, optional)
  ├── icon: string (emoji, optional)
  ├── program: "200h" | "300h" | null
  └── createdAt: timestamp

courses/{courseId}/modules/{moduleId}
  ├── title_da: string
  ├── title_en: string
  ├── description_da: string
  ├── description_en: string
  ├── order: number (1, 2, 3...)
  └── icon: string (emoji)

courses/{courseId}/modules/{moduleId}/chapters/{chapterId}
  ├── title_da: string
  ├── title_en: string
  ├── content_da: string (HTML)
  ├── content_en: string (HTML)
  └── order: number (1, 2, 3...)

enrollments/{odcId}  (document ID = userId_courseId)
  ├── userId: string
  ├── courseId: string
  ├── enrolledAt: timestamp
  ├── enrolledBy: string ("admin")
  └── status: "active" | "completed" | "revoked"

courseProgress/{odcId}  (document ID = userId_courseId)
  ├── userId: string
  ├── courseId: string
  ├── viewed: map { "moduleId__chapterId": timestamp }
  ├── lastModule: string
  ├── lastChapter: string
  └── lastAccessedAt: timestamp

courseComments/{auto-generated-id}
  ├── userId: string
  ├── userName: string
  ├── courseId: string
  ├── moduleId: string
  ├── chapterId: string
  ├── content: string
  ├── createdAt: timestamp
  └── updatedAt: timestamp
```

## Firestore Security Rules

Add these rules to your Firestore security rules in the Firebase Console
(Firebase Console → Firestore Database → Rules):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User profiles
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Courses: top-level metadata readable by authenticated users
    match /courses/{courseId} {
      allow read: if request.auth != null;
    }

    // Course modules: readable by enrolled users
    match /courses/{courseId}/modules/{moduleId} {
      allow read: if request.auth != null
        && exists(/databases/$(database)/documents/enrollments/$(request.auth.uid + '_' + courseId))
        && get(/databases/$(database)/documents/enrollments/$(request.auth.uid + '_' + courseId)).data.status == 'active';
    }

    // Course chapters: readable by enrolled users
    match /courses/{courseId}/modules/{moduleId}/chapters/{chapterId} {
      allow read: if request.auth != null
        && exists(/databases/$(database)/documents/enrollments/$(request.auth.uid + '_' + courseId))
        && get(/databases/$(database)/documents/enrollments/$(request.auth.uid + '_' + courseId)).data.status == 'active';
    }

    // Enrollments: users can read their own
    match /enrollments/{enrollmentId} {
      allow read: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }

    // Course Progress: users can read/write their own
    match /courseProgress/{progressId} {
      allow read, write: if request.auth != null
        && (resource == null || resource.data.userId == request.auth.uid)
        && (request.resource == null || request.resource.data.userId == request.auth.uid);
    }

    // Course Comments
    match /courseComments/{commentId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}
```

## Composite Indexes Required

Firestore will prompt you to create these indexes when the queries first run.
You can also create them manually in Firebase Console → Firestore → Indexes:

1. **courseComments** — For loading chapter comments:
   - `courseId` ASC, `moduleId` ASC, `chapterId` ASC, `createdAt` DESC

2. **courseComments** — For "My Comments":
   - `courseId` ASC, `userId` ASC, `createdAt` DESC

3. **enrollments** — For loading user enrollments:
   - `userId` ASC, `status` ASC

## How to Enroll a Student

1. Go to Firebase Console → Firestore Database
2. Navigate to (or create) the `enrollments` collection
3. Create a new document with ID: `{userId}_{courseId}`
   - Example: `abc123_yt200`
4. Set the fields:
   ```
   userId: "abc123"          (the user's Firebase Auth UID)
   courseId: "yt200"          (must match a course document ID)
   enrolledAt: (timestamp)    (click the timestamp type)
   enrolledBy: "admin"
   status: "active"
   ```

To find a user's UID: Firebase Console → Authentication → Users → copy the UID

## How to Add Course Content

### 1. Create a Course

In Firestore, create a document in `courses` collection:
- Document ID: `yt200` (or whatever slug you choose)
- Fields:
  ```
  title_da: "200-timers Yogalæreruddannelse"
  title_en: "200-Hour Yoga Teacher Training"
  description_da: "Komplet kursusmateriale til din læreruddannelse"
  description_en: "Complete course material for your teacher training"
  icon: "🧘"
  program: "200h"
  ```

### 2. Add Modules

In `courses/yt200/modules`, create documents:
- Document ID: `hatha-sequence` (descriptive slug)
- Fields:
  ```
  title_da: "Hatha Sekvens"
  title_en: "Hatha Sequence"
  description_da: "Guide til klassiske Hatha yoga sekvenser"
  description_en: "Guide to classical Hatha yoga sequences"
  order: 1
  icon: "📖"
  ```

### 3. Add Chapters

In `courses/yt200/modules/hatha-sequence/chapters`, create documents:
- Document ID: `01-introduction` (sequential slug)
- Fields:
  ```
  title_da: "Introduktion"
  title_en: "Introduction"
  order: 1
  content_da: "<h2>Velkommen</h2><p>HTML content here...</p>"
  content_en: "<h2>Welcome</h2><p>HTML content here...</p>"
  ```

### Content HTML Format

Chapter content supports these HTML elements (styled automatically):
- `<h2>`, `<h3>` — Section headings (with orange accents)
- `<p>` — Paragraphs
- `<strong>` — Bold text (dark color)
- `<em>` — Italic text (orange color)
- `<ul>`, `<ol>`, `<li>` — Lists (orange markers)
- `<blockquote>` — Quotes/callouts (orange left border)
- `<img>` — Images (rounded corners, responsive)
- `<table>`, `<th>`, `<td>` — Data tables
- `<a>` — Links

### Images in Content

For images in course content, use Firebase Storage:
1. Upload images to Firebase Storage under a path like `courses/yt200/hatha-sequence/`
2. Get the download URL
3. Reference in content HTML: `<img src="https://firebasestorage.googleapis.com/...">`

## URLs

- Danish: `/kursus-materiale/?course=yt200`
- English: `/en/course-material/?course=yt200`
- Direct to chapter: `/kursus-materiale/?course=yt200&module=hatha-sequence&chapter=01-introduction`
- Profile My Courses tab: `/profil#mine-kurser` or `/en/profile#my-courses`
