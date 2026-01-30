# My Videos API Endpoint Specification

## Overview
This endpoint will replace the unreliable `studio.3speak.tv/mobile/api/my-videos` endpoint. It returns all videos for an authenticated user's own profile, including unpublished/scheduled videos.

---

## Endpoint Details

### Base URL
```
https://views.3speak.tv
```

### Route
```
GET /api/my-videos
```

### Authentication
**Required:** Yes

**Header:**
```
Authorization: Bearer <access_token>
```

The token should be validated to ensure the requesting user matches the videos being returned.

---

## Request Parameters

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 20 | Number of videos per page (max: 100) |
| `offset` | integer | No | 0 | Number of videos to skip for pagination |
| `status` | string | No | all | Filter by status: `all`, `published`, `scheduled`, `draft`, `encoding`, `deleted` |

**Example Request:**
```
GET /api/my-videos?limit=20&offset=0
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "total": 96,
    "limit": 20,
    "offset": 0,
    "videos": [
      {
        "video_id": "hhjkaoyt",
        "owner": "meno",
        "author": "meno",
        "permlink": "hhjkaoyt",
        "title": "Building Software, Funding Dreams, and Losing the Plot",
        "body": "Video description/content...",
        "status": "published",
        "publish_type": "immediate",
        "publish_data": null,
        "created_at": "2025-12-15T10:30:00Z",
        "updated_at": "2025-12-15T10:35:00Z",
        "duration": 625,
        "tags": ["technology", "software"],
        "images": {
          "thumbnail": "https://img.3speak.tv/hhjkaoyt/thumbnail.png",
          "poster": "https://img.3speak.tv/hhjkaoyt/poster.jpg"
        },
        "spkvideo": {
          "duration": 625,
          "video_v2": "hhjkaoyt"
        }
      },
      {
        "video_id": "xyz123abc",
        "owner": "meno",
        "author": "meno",
        "permlink": "xyz123abc",
        "title": "Upcoming Product Launch",
        "body": "Get ready for...",
        "status": "scheduled",
        "publish_type": "schedule",
        "publish_data": {
          "scheduled_at": "2026-01-10T15:00:00Z"
        },
        "created_at": "2026-01-05T08:20:00Z",
        "updated_at": "2026-01-05T08:20:00Z",
        "duration": 420,
        "tags": ["announcement"],
        "images": {
          "thumbnail": "https://img.3speak.tv/xyz123abc/thumbnail.png"
        },
        "spkvideo": {
          "duration": 420,
          "video_v2": "xyz123abc"
        }
      }
    ]
  }
}
```

### Error Response (401 Unauthorized)

```json
{
  "success": false,
  "error": "Invalid or missing authentication token"
}
```

### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "error": "Failed to fetch videos"
}
```

---

## Required Fields for Frontend

### Essential Video Object Fields

Based on the Card3 component analysis, each video object **MUST** include:

#### Core Identification
- `video_id` (string) - Unique video identifier
- `owner` (string) - Video owner username
- `author` (string or object) - Can be string or `{username: "meno"}`
- `permlink` (string) - Hive permlink for the video

#### Display Information
- `title` (string) - Video title
- `body` (string) - Video description/content
- `created_at` (ISO 8601 string) - Video creation timestamp
- `duration` (integer) - Video duration in seconds

#### Media Assets
- `images` (object)
  - `thumbnail` (string) - Thumbnail URL
  - `poster` (string, optional) - Poster image URL

- `spkvideo` (object)
  - `duration` (integer) - Duration in seconds
  - `video_v2` (string) - Video identifier

#### Status & Publishing (CRITICAL for icons/badges)
- `status` (string) - Current video status
  - **Possible values:** `published`, `scheduled`, `draft`, `encoding`, `deleted`, `failed`
  
- `publish_type` (string) - How the video was/will be published
  - **Possible values:** `immediate`, `schedule`, `draft`
  
- `publish_data` (object or null) - Publishing metadata
  - For scheduled posts: `{ "scheduled_at": "2026-01-10T15:00:00Z" }`
  - For immediate/draft: `null`

#### Optional but Recommended
- `tags` (array of strings) - Video tags
- `updated_at` (ISO 8601 string) - Last update timestamp

---

## Special Requirements

### 1. Scheduled Posts Icon Logic
For the scheduled calendar icon to appear, the video **MUST** have:
```javascript
video.publish_type === 'schedule' 
  && video.status === 'scheduled' 
  && video.publish_data?.scheduled_at !== null
```

**Frontend Usage Example:**
```jsx
{video.publish_type === 'schedule' && video.status === 'scheduled' && (
  <div className="scheduled-badge" 
       title={`Scheduled for ${dayjs(video.publish_data?.scheduled_at).format('MMM D, YYYY h:mm A')}`}>
    <IoCalendarOutline size={18} />
    <span>Posts in {dayjs(video.publish_data?.scheduled_at).fromNow()}</span>
  </div>
)}
```

### 2. Status Badge Icons (Future Frontend Implementation)
Each status should eventually have a visual indicator:
- `published` ✅ - Green checkmark
- `scheduled` 📅 - Calendar icon (already implemented)
- `draft` 📝 - Draft icon
- `encoding` ⚙️ - Processing icon
- `deleted` 🗑️ - Trash icon
- `failed` ❌ - Error icon

### 3. Pagination Logic
- Backend should **order by** `created_at DESC` (newest first)
- Return total count so frontend knows when to stop loading more
- Support `offset` + `limit` for infinite scroll

---

## Data Source Considerations

The backend should retrieve this data from:
1. **Studio database** - Where video metadata, status, and publish settings are stored
2. **IPFS/CDN** - For thumbnail URLs
3. Ensure proper **JOIN** to get all required fields in a single query

---

## Notes

- This endpoint is **ONLY** for authenticated users viewing **their own** videos
- Other users viewing a profile should use the public `/apiv2/feeds/@username` endpoint (which only shows published videos)
- All timestamps should be in **ISO 8601 format** with timezone
- Status values should be **lowercase strings**
- The `scheduled_at` timestamp is **critical** for showing countdown timers ("Posts in 2 days")

---

## Testing Checklist

After implementing, verify:
- [ ] Returns all 96 videos (not limited to 50)
- [ ] Includes scheduled videos with proper `publish_data.scheduled_at`
- [ ] Pagination works correctly (offset + limit)
- [ ] Authentication validates token properly
- [ ] Returns proper status codes (200, 401, 500)
- [ ] All required fields are present in each video object
- [ ] Timestamps are in correct format
- [ ] Handles edge cases (0 videos, invalid token, etc.)
