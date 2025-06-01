// utils/email.js
const nodemailer = require("nodemailer");
const pug = require("pug");
const htmlToText = require("html-to-text");

module.exports = class Email {
  constructor(user, url, tempPassword) {
    this.to = user.email;
    this.firstName = user.firstName;
    this.url = url;
    this.tempPassword = tempPassword;
    this.from = `The Fifthlab Team <${process.env.EMAIL_FROM}>`;
    console.log("Email constructor:", {
      to: this.to,
      firstName: this.firstName,
      url,
      tempPassword,
      from: this.from,
    });
  }

  newTransport() {
    if (process.env.NODE_ENV === "production") {
      console.log("Using Gmail transport");
      return nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USERNAME1,
          pass: process.env.EMAIL_PASSWORD1,
        },
      });
    }
    console.log("Using Mailtrap transport:", {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      user: process.env.EMAIL_USERNAME,
    });
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  async send(template, subject) {
    console.log(
      "Rendering template:",
      `${__dirname}/../views/email/${template}.pug`
    );
    const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
      firstName: this.firstName,
      url: this.url,
      tempPassword: this.tempPassword,
      subject,
    });

    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: htmlToText.convert(html),
    };
    console.log("Mail options:", { from: this.from, to: this.to, subject });

    try {
      await this.newTransport().sendMail(mailOptions);
      console.log(`Email sent successfully to ${this.to}`);
    } catch (error) {
      console.error(`Failed to send email to ${this.to}:, error`);
      throw error; // Re-throw to catch in controller
    }
  }

  async sendWelcome() {
    await this.send("welcome", "Welcome to Fifthlab!");
  }

  async sendPasswordReset() {
    await this.send("passwordReset", "Reset Your Fifthlab Password");
  }

  async sendTemporaryPassword() {
    await this.send("teamMemberWelcome", "Your Fifthlab Team Account Details");
  }
};
