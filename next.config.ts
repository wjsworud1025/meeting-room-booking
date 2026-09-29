import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.LAN_TEST_HOST?'.next-lan':process.env.SLACK_TEST_ENV==='true'?'.next-slack':'.next',
  allowedDevOrigins: process.env.LAN_TEST_HOST?[process.env.LAN_TEST_HOST]:[],
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg','nodemailer'],
  async headers() { return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'same-origin'},
  ]}]; },
};
export default config;
