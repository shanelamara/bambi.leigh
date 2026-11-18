# bambi.byleigh storefront design

A static storefront recreated from the reference site for bambi.byleigh.

Included:
- Home landing page
- Product catalog page
- Handcrafted pastel art aesthetic
- Local artwork SVGs and animation assets

## Run locally

Use Node.js 24 or later and run `node server.js` from this folder. Open
http://127.0.0.1:3000/ for the storefront.

## Manage authentication photos

For local use, the server can read a strong, unique secret of at least 16
characters from `.private/admin-access-code`. The folder is excluded from Git.
You can override the file by setting `ADMIN_ACCESS_CODE` before starting the
server. In PowerShell, enter it without echoing it or storing it in command
history.

```powershell
$env:ADMIN_ACCESS_CODE = [System.Net.NetworkCredential]::new('', (Read-Host 'Admin access code' -AsSecureString)).Password
node server.js
```

Open http://127.0.0.1:3000/admin/photos and sign in. The gallery accepts JPEG,
PNG, and WebP files up to 5 MB. Editing can change the name, replace the image,
or do both. Deletion requires confirmation. Admin access is disabled when no code
is configured.

To display a photo on the homepage, select **Show on website** when adding or
editing it. Visitors can see published images and their names. Clear the option
or delete the photo to remove it from the homepage. New uploads start private unless published.

The **Storefront photos** section manages the seven photos already used by the
homepage, art gallery, and product catalog. Edit a photo there to replace it
across all of its existing placements, or clear **Show on website** to hide it.
Use **Additional photos** to add standalone images to the homepage gallery.
With two or more published photos, the gallery rotates automatically and
provides previous, next, and pause controls.

Each photo and its metadata are saved together in a private file under
`.private` by default. For a deployment, set `PHOTO_DATA_DIR` to a persistent
directory outside the public assets and restrict it to the server account.
Use one server process per storage directory. Serve the loopback Node process through a TLS reverse proxy,
set `PUBLIC_ORIGIN` to the external HTTPS origin, and supply the admin code
through the deployment's secret configuration. Sessions expire after eight hours.
Local sessions also end when the server restarts.

The existing storefront has no photo verifier. The protected
`GET /api/admin/photos` and `GET /api/admin/photos/{id}/image` endpoints read the
current records and images from the private files and require an admin session.

## Deploy to Vercel

Deploy this repository root with `vercel.json` included. In the Vercel project's
**Storage** tab, create and connect a **private** Blob store. This provides the
`BLOB_READ_WRITE_TOKEN` environment variable and stores photos as private files.
Under **Settings → Environment Variables**, set `ADMIN_ACCESS_CODE` to a strong
random secret and set `PUBLIC_ORIGIN` to the exact public site origin, for example
`https://bambileigh-t9ze.vercel.app`. Apply these settings to Production and
redeploy. Open `/admin` or `/admin/photos` on the deployed domain.

If `.env.vercel.local` exists in your workspace, copy its `ADMIN_ACCESS_CODE`
and `PUBLIC_ORIGIN` values into the project's Production environment variables.
The file stays local. Vercel supplies the Blob token when you connect the store.

Vercel accepts photos up to 3 MB through the admin uploader. The local credential
file and locally uploaded photos are excluded from deployment. Upload any photos
you want to keep on the live site through its admin page.
