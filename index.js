
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import "dotenv/config";
import { auth } from "./auth.js";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

const app = express();
const PORT = process.env.PORT || 5000;

// Multer image storage (memory)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 3,
  },
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

// Better Auth Handler
app.all("/api/auth/*splat", toNodeHandler(auth));

// Parse JSON request body
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
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

// GET: My Listings
app.get("/my-listings", verifySession, async (req, res) => {
  try {
    const myStudios = await studiosCollection
      .find(getStudioOwnerFilter(req.user))
      .sort({ createdAt: -1 })
      .toArray();

    res.send(myStudios);
  } catch (error) {
    console.error("Failed to fetch my listings:", error);

    res.status(500).send({
      message: "Failed to fetch my listings",
    });
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

// GET: Featured Studios
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

// POST: Upload Multiple Images to ImgBB
app.post(
  "/upload",
  verifySession,
  upload.array("images", 3),
  async (req, res) => {
    try {
      if (!process.env.IMGBB_API_KEY) {
        return res.status(500).send({
          message: "ImgBB API key is missing",
        });
      }

      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).send({
          message: "No images uploaded",
        });
      }

      const gallery = [];

      for (const file of files) {
        const formData = new FormData();

        formData.append("image", file.buffer.toString("base64"));

        const response = await fetch(
          `https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`,
          {
            method: "POST",
            body: formData,
          },
        );

        const result = await response.json();

        if (!response.ok || !result.success || !result.data?.url) {
          throw new Error(
            result.error?.message || "Failed to upload image to ImgBB",
          );
        }

        gallery.push(result.data.url);
      }

      res.status(200).send({
        message: "Images uploaded successfully",
        gallery,
        image: gallery[0],
      });
    } catch (error) {
      console.error("Image upload failed:", error);

      res.status(500).send({
        message: error.message || "Failed to upload images",
      });
    }
  },
);

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

// PUT: Update Studio
app.put("/studios/:id", verifySession, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid studio ID" });
    }

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

// DELETE: Studio
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

    const subtotal = studio.hourlyRate * hours;
    const serviceFee = Math.round(subtotal * 0.08);
    const total = subtotal + serviceFee + studio.deposit;

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
    const bookings = await bookingCollection
      .find({
        userEmail: req.user.email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedBookings = await Promise.all(
      bookings.map(async (booking) => {
        const studio = ObjectId.isValid(booking.studioId)
          ? await studiosCollection.findOne({
              _id: new ObjectId(booking.studioId),
            })
          : null;

        const startTime = booking.startTime || booking.hours?.[0] || "09:00";

        const endTime =
          booking.hours?.[1] ||
          formatTime(
            toMinutes(startTime) + Number(booking.duration || 1) * 60,
          );

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
    // Get logged-in user's studios
    const studios = await studiosCollection
      .find(getStudioOwnerFilter(req.user))
      .toArray();

    const ownedIdStrings = studios.map((studio) => studio._id.toString());

    console.log("Dashboard user:", req.user.email);
    console.log("Dashboard studio IDs:", ownedIdStrings);

    // Bookings received on my studios + bookings I made myself
    const bookings = await bookingCollection
      .find({
        $or: [
          { studioId: { $in: ownedIdStrings } },
          { studioId: { $in: studios.map((studio) => studio._id) } },
          { userEmail: req.user.email },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    console.log("Dashboard bookings count:", bookings.length);

    // Booking is "received" when it was made on one of my studios
    const isReceived = (booking) =>
      ownedIdStrings.includes(String(booking.studioId));

    const isCancelled = (booking) =>
      String(booking.status || "").toLowerCase() === "cancelled";

    // Earnings for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentEarnings = bookings
      .filter(
        (booking) =>
          isReceived(booking) &&
          new Date(booking.createdAt) >= thirtyDaysAgo &&
          !isCancelled(booking),
      )
      .reduce((total, booking) => total + Number(booking.total || 0), 0);

    // Calculate average studio rating
    const ratings = studios
      .map((studio) => Number(studio.rating))
      .filter((rating) => Number.isFinite(rating) && rating > 0);

    const averageRating = ratings.length
      ? Number(
          (
            ratings.reduce((sum, rating) => sum + rating, 0) /
            ratings.length
          ).toFixed(1),
        )
      : 0;

    // Prepare recent activity
    const recentActivity = bookings.slice(0, 4).map((booking) => ({
      id: booking._id.toString(),
      title: isReceived(booking)
        ? `New booking request — ${booking.studioTitle || "Studio"}`
        : `You booked — ${booking.studioTitle || "Studio"}`,
      detail: `${booking.date} · ${booking.startTime || ""} · ${booking.guests || 1} guests`,
      status: formatStatus(booking.status),
      createdAt: booking.createdAt,
    }));

    console.log("Dashboard recent activity:", recentActivity.length);

    res.send({
      summary: {
        totalBookings: bookings.filter((booking) => !isCancelled(booking))
          .length,
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



// Multer / general error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "Each image must be smaller than 20 MB.",
      LIMIT_FILE_COUNT: "You can upload a maximum of 3 images.",
      LIMIT_UNEXPECTED_FILE: "You can upload a maximum of 3 images.",
    };
    return res
      .status(400)
      .send({ message: messages[err.code] || err.message });
  }

  if (err) {
    return res.status(400).send({ message: err.message || "Request failed" });
  }

  next();
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port: ${PORT}`);
});
