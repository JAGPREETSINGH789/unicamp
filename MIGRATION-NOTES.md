# UniCampus Store — Replit-inspired visual migration

This package uses the existing `try-main` application as the source of truth for commerce data and business logic, with a new Replit-inspired visual layer.

## Preserved from the existing website
- Existing product catalog, product IDs, prices, descriptions, stock, tags, images and galleries.
- Existing customer storefront interactions, cart/checkout/account flows and order creation/tracking.
- Existing admin portal and its API-driven order, product, revenue, discount and customer-support management.
- Existing printing storefront, printing operator login, uploaded-file handling, printing orders, payment/status updates and editable printing service prices.
- Existing Express/Turso/Vercel API implementation and environment-variable names.

## Visual updates
- Cream/off-white surfaces, forest-green primary actions, Manrope + DM Sans typography, rounded cards and cleaner spacing.
- Storefront header, category navigation, hero, category tiles, product cards and mobile breakpoints receive the new theme.
- Admin portal and printing operator screens share the same palette and typography.
- Admin navigation includes a direct Printing Operations link.
- Added the four generated campus category/lifestyle images as additional assets; existing product images are untouched.

## Routes
- Store: `/`
- Admin portal: `/admin`
- Printing storefront: `/printing`
- Printing operations: `/printing-admin`

## Deployment
Deploy this project using the same Vercel project and existing environment variables as the current site. Do not replace the existing Turso database or rotate secrets as part of this visual migration. The existing `vercel.json` and `api/admin.js` are retained.

## Important verification before production
This is a source-level visual migration, not a live production deployment. Test the storefront, checkout, admin login, order status changes, product edits, printing login, file downloads and printing payment/status updates against the production database in a staging deployment before switching the live domain. No database migration is intended by this package.
