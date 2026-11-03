
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";
import { auth } from "./auth.js";
import { fromNodeHeaders } from "better-auth/node";

const app = express();
const PORT = process.env.PORT || 5000;

// Uploads folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded images
app.use("/uploads", express.static(uploadsDir));

// Multer image storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname).toLowerCase();

    cb(null, `studio-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Middlewares
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  }),
);

app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
    throw err;
  }
}

const connectClient = await connectToMongoDB();

const db = connectClient.db("sceneslot-db");

const studiosCollection = db.collection("studios");
const userCollection = db.collection("users");
const bookingCollection = db.collection("bookings");

// Verify logged-in user
async function verifySession(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).send({
        message: "Unauthorized. Please login first.",
      });
    }

    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    console.error("Session verification failed:", error);

    res.status(401).send({
      message: "Invalid session",
    });
  }
}

// Studio ownership filter
function getStudioOwnerFilter(user) {
  return {
    $or: [
      { ownerId: user.id },
      { ownerEmail: user.email },
      { "host.email": user.email },
    ],
  };
}

// Convert time to minutes
function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

// Convert minutes to HH:MM format
function formatTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Normalize booking status for frontend
function formatStatus(status) {
  const normalized = String(status || "pending").toLowerCase();

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// GET: All Studios
app.get("/studios", async (req, res) => {
  try {
    const result = await studiosCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("Failed to fetch studios:", error);
    res.status(500).send({ message: "Failed to fetch studios" });
  }
});

// POST: Add Studio
app.post("/studios", verifySession, async (req, res) => {
  try {
    const studioData = {
      ...req.body,
      ownerId: req.user.id,
      ownerEmail: req.user.email,
      ownerName: req.user.name,
      createdAt: new Date(),
    };

    const result = await studiosCollection.insertOne(studioData);

    res.status(201).send({
      message: "Studio added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Failed to add studio:", error);
    res.status(500).send({ message: "Failed to add studio" });
  }
});

// GET: Featured Studios (Latest 6)
app.get("/featured-studios", async (req, res) => {
  try {
    const result = await studiosCollection
      .find()
      .sort({ _id: -1 })
      .limit(6)
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch featured studios:", error);
    res.status(500).send({ message: "Failed to fetch featured studios" });
  }
});

// POST: Image Upload
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).send({
      error: "No image uploaded",
    });
  }

  const imageUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;

  res.send({ imageUrl });
});

// GET: Single Studio Details
app.get("/studios/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid studio ID" });
    }

    const result = await studiosCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({ message: "Studio not found" });
    }

    res.send(result);
  } catch (error) {
    console.error("Failed to fetch studio:", error);
    res.status(500).send({ message: "Failed to fetch studio" });
  }
});

// PUT: Update Studio (Owner Only)
app.put("/studios/:id", verifySession, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid studio ID" });
    }

    // Prevent changing ownership through request body
    const { ownerId, ownerEmail, ownerName, createdAt, ...updatedData } =
      req.body;

    const result = await studiosCollection.updateOne(
      {
        _id: new ObjectId(id),
        ...getStudioOwnerFilter(req.user),
      },
      {
        $set: updatedData,
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Studio not found or you are not the owner",
      });
    }

    res.send({
      message: "Studio updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Failed to update studio:", error);
    res.status(500).send({ message: "Failed to update studio" });
  }
});

// DELETE: Studio (Owner Only)
app.delete("/studios/:id", verifySession, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid studio ID" });
    }

    const result = await studiosCollection.deleteOne({
      _id: new ObjectId(id),
      ...getStudioOwnerFilter(req.user),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Studio not found or you are not the owner",
      });
    }

    res.send({
      message: "Studio deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Failed to delete studio:", error);
    res.status(500).send({ message: "Failed to delete studio" });
  }
});

// POST: Create Booking
app.post("/bookings", verifySession, async (req, res) => {
  try {
    const { studioId, date, startTime, duration, guests } = req.body;

    // Validate required fields
    if (!studioId || !date || !startTime || !duration || !guests) {
      return res.status(400).send({
        message: "All fields are required",
      });
    }

    if (!ObjectId.isValid(studioId)) {
      return res.status(400).send({
        message: "Invalid studio ID",
      });
    }

    const hours = Number(duration);
    const crewSize = Number(guests);

    if (
      ![1, 2, 3, 4, 6, 8].includes(hours) ||
      !Number.isInteger(crewSize) ||
      crewSize < 1
    ) {
      return res.status(400).send({
        message: "Invalid duration or crew size",
      });
    }

    // Validate start time
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      return res.status(400).send({
        message: "Invalid start time",
      });
    }

    const newStart = toMinutes(startTime);
    const newEnd = newStart + hours * 60;

    if (newEnd > 24 * 60) {
      return res.status(400).send({
        message: "Booking cannot extend beyond midnight",
      });
    }

    // Find studio
    const studio = await studiosCollection.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    if (crewSize > studio.maxCapacity) {
      return res.status(400).send({
        message: "Crew size exceeds studio capacity",
      });
    }

    // Check overlapping Pending and Confirmed bookings
    const existingBookings = await bookingCollection
      .find({
        studioId,
        date,
        status: {
          $in: ["Pending", "pending", "Confirmed", "confirmed"],
        },
      })
      .toArray();

    const hasConflict = existingBookings.some((booking) => {
      const oldStart = toMinutes(booking.startTime);
      const oldEnd = oldStart + Number(booking.duration) * 60;

      return newStart < oldEnd && newEnd > oldStart;
    });

    if (hasConflict) {
      return res.status(409).send({
        message: "This time slot is already booked",
      });
    }

    // Calculate price using database values
    const subtotal = studio.hourlyRate * hours;
    const serviceFee = Math.round(subtotal * 0.08);
    const total = subtotal + serviceFee + studio.deposit;

    // Booking data
    const bookingData = {
      studioId,
      studioTitle: studio.title,
      studioImage: studio.image,
      category: studio.category,
      location: studio.location,

      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,

      date,
      startTime,
      duration: hours,
      hours: [startTime, formatTime(newEnd)],
      guests: crewSize,

      hourlyRate: studio.hourlyRate,
      subtotal,
      serviceFee,
      deposit: studio.deposit,
      total,

      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(bookingData);

    res.status(201).send({
      message: "Booking request submitted successfully",
      bookingId: result.insertedId,
    });
  } catch (error) {
    console.error("Booking error:", error);

    res.status(500).send({
      message: "Failed to create booking",
    });
  }
});

// PATCH: Cancel Booking
app.patch("/bookings/:id/cancel", verifySession, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid booking ID",
      });
    }

    const result = await bookingCollection.updateOne(
      {
        _id: new ObjectId(id),
        userEmail: req.user.email,
        status: { $in: ["Pending", "pending"] },
      },
      {
        $set: {
          status: "Cancelled",
          cancelledAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Booking not found or cannot be cancelled",
      });
    }

    res.send({
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel booking error:", error);

    res.status(500).send({
      message: "Failed to cancel booking",
    });
  }
});

// GET: My Bookings
app.get("/my-bookings", verifySession, async (req, res) => {
  try {
    // Find bookings belonging to the logged-in user
    const bookings = await bookingCollection
      .find({
        userEmail: req.user.email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Prepare data for BookingCard
    const formattedBookings = await Promise.all(
      bookings.map(async (booking) => {
        // Get studio details for older bookings
        const studio = ObjectId.isValid(booking.studioId)
          ? await studiosCollection.findOne({
              _id: new ObjectId(booking.studioId),
            })
          : null;

        const startTime = booking.startTime || booking.hours?.[0] || "09:00";

        const endTime =
          booking.hours?.[1] ||
          formatTime(toMinutes(startTime) + Number(booking.duration || 1) * 60);

        return {
          id: booking._id.toString(),
          studioId: booking.studioId,
          studioTitle: booking.studioTitle || studio?.title || "Studio",
          studioImage: booking.studioImage || studio?.image || "",
          category: booking.category || studio?.category || "Photo Studios",
          location:
            booking.location || studio?.location || "Location unavailable",
          date: booking.date,
          hours: [startTime, endTime],
          guests: Number(booking.guests || 1),
          total: Number(booking.total || 0),
          status: formatStatus(booking.status),
        };
      }),
    );

    res.send(formattedBookings);
  } catch (error) {
    console.error("Failed to fetch my bookings:", error);

    res.status(500).send({
      message: "Failed to fetch bookings",
    });
  }
});

// GET: Dashboard Data
app.get("/dashboard", verifySession, async (req, res) => {
  try {
    // Find studios owned by the logged-in user
    const studios = await studiosCollection
      .find(getStudioOwnerFilter(req.user))
      .toArray();

    const studioIds = studios.map((studio) => studio._id.toString());

    // Find bookings for those studios
    const bookings = studioIds.length
      ? await bookingCollection
          .find({
            studioId: { $in: studioIds },
          })
          .sort({ createdAt: -1 })
          .toArray()
      : [];

    // Calculate earnings for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentEarnings = bookings
      .filter((booking) => {
        const createdAt = new Date(booking.createdAt);

        return (
          createdAt >= thirtyDaysAgo &&
          !["cancelled", "Cancelled"].includes(booking.status)
        );
      })
      .reduce((total, booking) => total + Number(booking.total || 0), 0);

    // Calculate average studio rating
    const ratings = studios
      .map((studio) => Number(studio.rating))
      .filter((rating) => Number.isFinite(rating) && rating > 0);

    const averageRating = ratings.length
      ? Number(
          (
            ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
          ).toFixed(1),
        )
      : 0;

    // Prepare recent activity
    const recentActivity = bookings.slice(0, 4).map((booking) => ({
      id: booking._id.toString(),
      title: `New booking request — ${booking.studioTitle || "Studio"}`,
      detail: `${booking.date} · ${booking.startTime || ""} · ${booking.guests || 1} guests`,
      status: formatStatus(booking.status),
      createdAt: booking.createdAt,
    }));

    res.send({
      summary: {
        totalBookings: bookings.filter(
          (booking) => !["cancelled", "Cancelled"].includes(booking.status),
        ).length,
        earnings: recentEarnings,
        averageRating,
        totalListings: studios.length,
      },
      recentActivity,
    });
  } catch (error) {
    console.error("Dashboard data error:", error);

    res.status(500).send({
      message: "Failed to fetch dashboard data",
    });
  }
});

// Test Route
app.get("/", (req, res) => {
  res.send("SceneSlot server is running!");
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port: ${PORT}`);
});
