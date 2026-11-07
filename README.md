# SceneSlot – Server

SceneSlot is the backend application for the SceneSlot Creative Studio Booking Platform. It provides server-side functionality to support studio listings, user authentication, and booking management.

## Related Links

- **Live Website:** [SceneSlot](https://sceneslot-client.vercel.app)
- **Client Repository:** [SceneSlot Client](https://github.com/NadiaDipa/sceneslot-client-side)
- **Server Repository:** [SceneSlot Server](https://github.com/NadiaDipa/sceneslot-server-side)

## Features

- Backend API for studio management.
- Studio listing, updating, and deletion.
- Booking creation and management.
- User authentication integration.
- MongoDB database integration.
- Image hosting integration.
- Server-side request handling and error responses.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | Runtime environment |
| Express.js | Backend framework |
| MongoDB | Database |
| Better Auth | Authentication |
| ImgBB | Image hosting |

## Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/NadiaDipa/sceneslot-server-side.git sceneslot-server
cd sceneslot-server
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_auth_secret
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
IMGBB_API_KEY=your_imgbb_api_key
```

Replace the placeholder values with your own credentials.

### 4. Run the Server

```bash
npm run dev
```

The server will run at:

`http://localhost:5000`

## Project Overview

SceneSlot's backend supports the platform's core operations and connects the frontend application with the database and other integrated services.