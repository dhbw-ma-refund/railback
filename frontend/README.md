# RailBack Frontend

Multi-app frontend setup for RailBack project.

## Structure

- **Main App** (React + Vite) - Landing page and user forms
- **Admin Panel** (SolidJS + Vite) - Admin dashboard
- **Shared** - Design system components and styles

## Running the Apps

### Main App (Landing + User Forms)
```bash
npm run dev
```
Runs on http://localhost:5173

### Admin Panel
```bash
cd admin-panel
npm install
npm run dev
```
Runs on http://localhost:5174

## Development

Both apps share the same design system from `/shared` folder:
- Styles: `@shared/styles/global.css`
- Components: `@shared/components` (Button, Input, Card, StatusBadge)
- Based on RailBack Brand Guide

## Routes

### Main App
- `/` - Landing page
- `/user` - User ticket submission form

### Admin Panel  
- `/login` - Admin login
- `/` - Dashboard
- `/overview` - Overview
- `/users` - User management
- `/tickets` - Ticket management
