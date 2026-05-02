{
  "name": "{{PACKAGE_NAME}}-monitoring",
  "version": "1.0.0",
  "description": "GCP Cloud Monitoring alert policy automation for {{PROJECT_DISPLAY_NAME}}",
  "private": true,
  "scripts": {
    "test": "jest --verbose",
    "setup": "node setup-monitoring.js"
  },
  "dependencies": {
    "@google-cloud/logging": "^11.2.0",
    "@google-cloud/monitoring": "^5.3.1"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
