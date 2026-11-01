# 🚨 Smart Fire & Safety Detection System

A modern, real-time web application for fire detection, environmental monitoring, and instant emergency alerts. Built with **React**, **Vite**, and **Supabase**, this project provides a comprehensive dashboard for tracking critical sensor data and triggering safety notifications.

---

## 🌟 Key Features

* 🟢 **Real-Time Sensor Monitoring:** Live tracking of environmental metrics including temperature, smoke levels, and flame detection.
* 🚨 **Emergency Alerts & Popups:** Instant visual alerts and sound alarms (`AudioService`) upon detecting critical hazard levels.
* 🔔 **Push Notifications:** Browser notification service (`NotificationService`) to warn users immediately in case of emergency.
* 🔒 **User Authentication:** Secure user sign-up, sign-in, and session management powered by **Supabase Auth**.
* 📊 **Database Integration:** Real-time data logging and history management using Supabase database.

---

## 🛠️ Tech Stack

* **Frontend:** React.js, Vite, CSS3 / Tailwind CSS
* **Backend & Database:** Supabase (PostgreSQL & Realtime API)
* **Browser APIs:** Web Audio API, Web Notifications API

---

## 📁 Project Structure

```text
smart-fire-detections/
├── src/
│   ├── components/       # UI Components (Emergency Banners, Popups)
│   ├── services/         # Audio, Notification, Sensor & Auth Services
│   ├── lib/              # Supabase Client Configuration
│   ├── App.jsx           # Main Application Layout
│   └── main.jsx          # Application Entry Point
├── supabase_schema.sql   # Database Tables & Triggers Script
├── .env.example          # Environment Variables Template
└── package.json          # Project Dependencies & Scripts