const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select(
    "firstName lastName email accountName"
  );

  res.status(200).json({
    success: true,
    data: user
      ? {
          id: user._id.toString(),
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          accountName: user.accountName,
        }
      : null,
  });
});

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, search } = req.query;
  const skip = (page - 1) * limit;

  const query = { active: true };
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(query)
    .select("firstName lastName email accountName")
    .skip(skip)
    .limit(Number(limit));

  res.status(200).json({
    status: "success",
    results: users.length,
    data: {
      users: users.map((user) => ({
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountName: user.accountName,
      })),
    },
  });
});
exports.searchUsers = catchAsync(async (req, res, next) => {
  const { search } = req.query;
  if (!search || typeof search !== "string") {
    return res.status(200).json({
      status: "success",
      results: 0,
      data: { users: [] },
    });
  }

  const users = await User.find({
    $or: [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
    ],
  }).select("firstName lastName email accountName");

  res.status(200).json({
    status: "success",
    results: users.length,
    data: {
      users: users.map((user) => ({
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountName: user.accountName,
      })),
    },
  });
});
exports.updateMe = catchAsync(async (req, res, next) => {
  // Prevent password updates
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        "This route is not for password updates. Use /updateMyPassword.",
        400
      )
    );
  }

  // Log request for debugging
  console.log("req.body:", req.body);
  console.log("req.user:", req.user);

  // Filter allowed fields based on schema
  const filteredBody = filterObj(req.body, "firstName", "lastName", "email");
  console.log("filteredBody:", filteredBody);

  // Check if filteredBody is empty
  if (Object.keys(filteredBody).length === 0) {
    return next(new AppError("No valid fields provided for update", 400));
  }

  // Update user
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  }).select("-password");

  // Check if user was found and updated
  if (!updatedUser) {
    return next(new AppError("User not found", 404));
  }

  console.log("updatedUser:", updatedUser);

  res.status(200).json({
    status: "success",
    data: { user: updatedUser },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });
  res.status(204).json({
    status: "success",
    data: null,
  });
});

exports.updateUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).select("-password");

  if (!user) {
    return next(new AppError("No user found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: { user },
  });
});

exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    return next(new AppError("No user found with that ID", 404));
  }
  res.status(204).json({
    status: "success",
    data: null,
  });
});

exports.createUser = catchAsync(async (req, res, next) => {
  const newUser = await User.create(req.body);
  res.status(201).json({
    status: "success",
    data: { user: newUser },
  });
});
