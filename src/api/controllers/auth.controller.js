const User = require("../models/user.model");
const config = require("../../config/config");

exports.register = async (req, res) => {
  try {
    const { name } = req.body;

    // Validate input
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Create a new user
    const user = await User.create({ name });

    // Respond with user data and token
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Handle duplicate key errors (e.g., if email is added later and made unique)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "User already exists",
      });
    }

    res.status(500).json({
      success: false,
      error: "Registration failed. Please try again.",
    });
  }
};
