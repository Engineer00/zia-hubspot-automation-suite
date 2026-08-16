# HubSpot setup automation

This folder contains the first step of the HubSpot automation setup for the ZIA demo.

## Files

- `hubspot_validate_key.js` — validates the service key and confirms API access.
- `hubspot_setup_properties.js` — creates the first CRM property set.

## Usage

Set your token first:

```bash
export HUBSPOT_TOKEN="your_service_key_here"
node hubspot_validate_key.js
node hubspot_setup_properties.js
node hubspot_full_setup.js
```

On PowerShell:

```powershell
$env:HUBSPOT_TOKEN = "your_service_key_here"
node .\hubspot_validate_key.js
node .\hubspot_setup_properties.js
node .\hubspot_full_setup.js
```

## Notes

- This is a trial-safe setup focused on CRM objects and workflow-friendly properties.
- The project intentionally avoids over-scoping the HubSpot app to keep the setup clean and realistic.
- `hubspot_full_setup.js` is the main automation entry point for the first pass of the ZIA demo build.
- It validates the Service Key, creates the schema properties, and sets up the core deal pipelines.
