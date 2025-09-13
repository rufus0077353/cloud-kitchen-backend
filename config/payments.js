// /server/config/payments.js
const required = (v, name) => {
  if (!v) {
    // log loudly on boot if keys are missing
    console.error(`[payments] Missing ${name}. Set it in your backend .env`);
  }
  return v;
};

module.exports = {
  razorpayKeyId: required(process.env.RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID"),
  razorpayKeySecret: required(process.env.RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET"),
};