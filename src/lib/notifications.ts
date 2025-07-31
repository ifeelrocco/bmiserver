import nodemailer from 'nodemailer';
import chromium from 'chrome-aws-lambda';
import puppeteer from 'puppeteer-core';
import { supabase } from './supabase';
import fs from 'fs';
import path from 'path';

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT!),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendNotifications(bmiRecord: any) {
  try {
    const { data: notification, error } = await supabase
      .from('Notification')
      .insert({
        memberId: bmiRecord.memberId,
        bmiRecordId: bmiRecord.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Notification creation error:', error);
      return;
    }

    if (bmiRecord.member.phone) {
      await sendWhatsAppMessage(bmiRecord, notification.id);
    }

    if (bmiRecord.member.email) {
      await sendEmailReport(bmiRecord, notification.id);
    }
  } catch (error) {
    console.error('Notification error:', error);
  }
}

async function sendWhatsAppMessage(bmiRecord: any, notificationId: number) {
  try {
    const isNewCustomer = bmiRecord.member.customerType === 'new';
    const message = getWhatsAppTemplate(bmiRecord, isNewCustomer);

    // For development, log the WhatsApp message (replace with actual WhatsApp API when ready)
    console.log('WhatsApp message:', message);
    
    await supabase
      .from('Notification')
      .update({ whatsappSent: true, whatsappStatus: 'sent' })
      .eq('id', notificationId);
  } catch (error) {
    console.error('WhatsApp error:', error);
    await supabase
      .from('Notification')
      .update({ whatsappStatus: 'failed' })
      .eq('id', notificationId);
  }
}

async function sendEmailReport(bmiRecord: any, notificationId: number) {
  try {
    console.log('Starting email report generation...');
    const isNewCustomer = bmiRecord.member.customerType === 'new';
    const pdfBuffer = await generateHealthReportPDF(bmiRecord, isNewCustomer);
    
    const mailOptions = {
      from: process.env.GYM_EMAIL,
      to: bmiRecord.member.email,
      subject: getEmailSubject(bmiRecord.member, isNewCustomer),
      html: getEmailTemplate(bmiRecord, isNewCustomer),
      attachments: [{
        filename: `${bmiRecord.member.name.replace(/\s+/g, '-')}-Health-Report.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    };
    
    console.log('Sending email to:', bmiRecord.member.email);
    await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully');
    
    await supabase
      .from('Notification')
      .update({ emailSent: true, emailStatus: 'sent' })
      .eq('id', notificationId);
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    await supabase
      .from('Notification')
      .update({ emailStatus: 'failed' })
      .eq('id', notificationId);
    throw error;
  }
}

function getEmailSubject(member: any, isNewCustomer: boolean): string {
  return isNewCustomer 
    ? `🎉 Your Fitness Report Is Ready - Welcome to ${process.env.GYM_NAME}!`
    : `🎉 Your Updated Fitness Report Is Ready`;
}

function getEmailTemplate(bmiRecord: any, isNewCustomer: boolean): string {
  if (isNewCustomer) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2563eb; text-align: center; margin-bottom: 10px;">🎉 Your Fitness Report Is Ready</h1>
          <p style="text-align: center; color: #666; margin-bottom: 30px;">Your fitness journey begins now!</p>
          
          <div style="background: linear-gradient(135deg, #e8f5e8, #d4edda); padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #155724; margin-bottom: 15px;">Your First BMI Assessment:</h3>
            <ul style="list-style: none; padding: 0;">
              <li style="padding: 5px 0;"><strong>BMI:</strong> ${bmiRecord.bmi}</li>
              <li style="padding: 5px 0;"><strong>Category:</strong> ${bmiRecord.category}</li>
              <li style="padding: 5px 0;"><strong>Weight:</strong> ${bmiRecord.weight} kg</li>
              <li style="padding: 5px 0;"><strong>Height:</strong> ${bmiRecord.height} cm</li>
              <li style="padding: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
            </ul>
          </div>
          
          <div style="background: linear-gradient(135deg, #fff3cd, #ffeaa7); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f39c12;">
            <h3 style="color: #856404; margin-bottom: 15px;">🎁 Welcome Bonus - FREE Worth ₹3,500!</h3>
            <ul style="color: #856404;">
              <li>✅ Personalized Diet Plan</li>
              <li>✅ One-on-One Training Session</li>
              <li>✅ Complete Gym Tour with Expert</li>
            </ul>
            <p style="color: #d63384; font-weight: bold; margin-top: 15px;">⏰ Claim within 3 days of joining!</p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee;">
            <p style="color: #666;">📞 Call/WhatsApp: <strong>${process.env.GYM_CONTACT}</strong></p>
            <p style="color: #666;">📍 Visit: <strong>${process.env.GYM_ADDRESS}</strong></p>
            <p style="color: #666;">Your detailed health report is attached as PDF.</p>
          </div>
        </div>
      </div>
    `;
  } else {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2563eb; text-align: center; margin-bottom: 10px;">🎉 Your Fitness Report Is Ready</h1>
          <p style="text-align: center; color: #666; margin-bottom: 30px;">Hi ${bmiRecord.member.name}, here is your latest BMI assessment:</p>
          <div style="background: linear-gradient(135deg, #e8f5e8, #d4edda); padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #155724; margin-bottom: 15px;">Your BMI Assessment:</h3>
            <ul style="list-style: none; padding: 0;">
              <li style="padding: 5px 0;"><strong>BMI:</strong> ${bmiRecord.bmi}</li>
              <li style="padding: 5px 0;"><strong>Category:</strong> ${bmiRecord.category}</li>
              <li style="padding: 5px 0;"><strong>Weight:</strong> ${bmiRecord.weight} kg</li>
              <li style="padding: 5px 0;"><strong>Height:</strong> ${bmiRecord.height} cm</li>
              <li style="padding: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
            </ul>
          </div>
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee;">
            <p style="color: #666;">📞 Call/WhatsApp: <strong>${process.env.GYM_CONTACT}</strong></p>
            <p style="color: #666;">📍 Visit: <strong>${process.env.GYM_ADDRESS}</strong></p>
            <p style="color: #666;">Your detailed health report is attached as PDF.</p>
          </div>
        </div>
      </div>
    `;
  }
}

function getWhatsAppTemplate(bmiRecord: any, isNewCustomer: boolean): string {
  if (isNewCustomer) {
    return `🎉 *Welcome to ${process.env.GYM_NAME}!*

Hi ${bmiRecord.member.name},

Your first BMI assessment is complete:
📊 *BMI: ${bmiRecord.bmi}*
📈 Category: ${bmiRecord.category}
⚖️ Weight: ${bmiRecord.weight} kg
📏 Height: ${bmiRecord.height} cm

🎁 *New Member Special Offers:*
- Free Diet Plan (Worth ₹3,500)
- Personal Training Session
- Complete Gym Tour with Expert

${getBMIAdvice(bmiRecord.category)}

📞 Call/WhatsApp: ${process.env.GYM_CONTACT}
📍 Visit: ${process.env.GYM_ADDRESS}

Welcome to your fitness journey! 💪`;
  } else {
    return `🏋️ *BMI Update Ready!*

Hi ${bmiRecord.member.name},

Your latest assessment shows:
📊 *Current BMI: ${bmiRecord.bmi}*
📈 Category: ${bmiRecord.category}
⚖️ Weight: ${bmiRecord.weight} kg
📏 Height: ${bmiRecord.height} cm
📅 Recorded: ${new Date().toLocaleDateString()}

${getBMIAdvice(bmiRecord.category)}

Keep up the great work! 💪

Contact: ${process.env.GYM_CONTACT}
Visit: ${process.env.GYM_ADDRESS}`;
  }
}

export async function generateHealthReportPDF(bmiRecord: any, isNewCustomer: boolean, externalBrowser?: any): Promise<Buffer> {
  let browser = null;
  let shouldCloseBrowser = true;
  
  try {
    console.log('Starting PDF generation...');
    
    // Use external browser if provided, otherwise create new one
    if (externalBrowser) {
      browser = externalBrowser;
      shouldCloseBrowser = false; // Don't close external browser
    } else {
      // Launch browser with serverless configuration
      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
    }

    console.log('Browser ready for PDF generation');

    const gymName = process.env.GYM_NAME || 'Your Gym Name';
    
    // Embed logo as base64 data URI
    const logoFilePath = path.join(process.cwd(), 'public', 'logo.png');
    let logoSrc = '';
    try {
      const logoData = fs.readFileSync(logoFilePath);
      logoSrc = `data:image/png;base64,${logoData.toString('base64')}`;
    } catch (e) {
      console.log('Logo not found, proceeding without logo');
      logoSrc = '';
    }

    // Check for uploaded images in the uploads directory
    let uploadedImageSrc = '';
    let uploadedImageCategory = '';
    let uploadedImageCustomerName = '';
    
    // Check for uploaded image info from environment variable (for API route usage)
    if (process.env.UPLOADED_IMAGE_INFO) {
      try {
        const imageInfo = JSON.parse(process.env.UPLOADED_IMAGE_INFO);
        uploadedImageSrc = imageInfo.src;
        uploadedImageCategory = imageInfo.category;
        uploadedImageCustomerName = imageInfo.customerName;
      } catch (e) {
        console.log('Error parsing uploaded image info from environment');
      }
    } else {
      // Fallback to checking uploads directory
      try {
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        if (fs.existsSync(uploadsDir)) {
          const files = fs.readdirSync(uploadsDir);
          if (files.length > 0) {
            // Get the most recent uploaded image
            const imageFiles = files.filter(file => 
              file.match(/\.(jpg|jpeg|png|gif|webp)$/i)
            );
            
            if (imageFiles.length > 0) {
              // Sort by modification time to get the most recent
              const sortedFiles = imageFiles.sort((a, b) => {
                const statA = fs.statSync(path.join(uploadsDir, a));
                const statB = fs.statSync(path.join(uploadsDir, b));
                return statB.mtime.getTime() - statA.mtime.getTime();
              });
              
              const latestImage = sortedFiles[0];
              const imagePath = path.join(uploadsDir, latestImage);
              const imageData = fs.readFileSync(imagePath);
              uploadedImageSrc = `data:image/png;base64,${imageData.toString('base64')}`;
              
              // Extract category from filename (format: category-timestamp.extension)
              const fileNameParts = latestImage.split('-');
              if (fileNameParts.length >= 2) {
                uploadedImageCategory = fileNameParts[0]; // 'new' or 'existing'
                uploadedImageCustomerName = 'Customer'; // Default name
              }
            }
          }
        }
      } catch (e) {
        console.log('No uploaded images found or error reading uploads directory');
        uploadedImageSrc = '';
      }
    }

    const personalRows = [
      ['Name -', bmiRecord.member.name],
      ['Contact -', bmiRecord.member.phone],
      ['Email -', bmiRecord.member.email || 'Not provided'],
      ['DOB -', bmiRecord.member.dateOfBirth ? new Date(bmiRecord.member.dateOfBirth).toLocaleDateString() : 'Not provided'],
      ['Relationship Status -', bmiRecord.member.relationshipStatus || 'Not provided'],
      ['Service looking -', bmiRecord.member.serviceLooking || 'Member'],
      ['Platform -', bmiRecord.member.platform || 'Member'],
    ];

    const bmiRows = [
      ['Age', bmiRecord.age || '-', '-'],
      ['Present Body Weight', bmiRecord.weight || '-', '-'],
      ['Ideal body weight', bmiRecord.idealBodyWeight || '-', '-'],
      ['Total Fat %', bmiRecord.totalFatPercentage || '-', '12 to 15'],
      ['Subcutaneous fat', bmiRecord.subcutaneousFat || '-', '-'],
      ['Visceral fat', bmiRecord.visceralFat || '-', '2 - 5%'],
      ['Muscle Mass', bmiRecord.muscleMass || '-', '-'],
      ['Resting Metabolism', bmiRecord.restingMetabolism || '-', '-'],
      ['Biological Age', bmiRecord.biologicalAge || '-', '-'],
      ['Body Mass index', bmiRecord.bmi || '-', '(18.5 to 24.9, it falls within the Healthy Weight range)'],
    ];

    const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Health Report</title>
        <style>
          @page { margin: 30mm 20mm 30mm 20mm; }
          body { font-family: Arial, sans-serif; margin: 0; }
          .page { page-break-after: always; }
          .header { text-align: center; margin-bottom: 20px; }
          .gym-logo-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 8px; }
          .gym-logo { height: 150px; width: auto; margin-bottom: 8px; }
          .section-title { font-size: 22px; font-weight: bold; margin: 24px 0 15px 0; }
          .attend-by { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 15px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 25px; }
          td, th { border: 1px solid #bbb; padding: 10px 15px; font-size: 17px; }
          th { background: #f0f0f0; font-weight: bold; }
          .conclusion-title { color: #d32f2f; font-size: 22px; font-weight: bold; margin-top: 25px; }
          .conclusion { margin-left: 18px; font-size: 17px; }
          .custom-msg { font-size: 17px; font-weight: bold; margin-top: 25px; }
          .blue-link { color: #2563eb; text-decoration: underline; font-size: 17px; }
          .uploaded-image-container { 
            text-align: center; 
            margin: 20px;
            padding: 20px;
            height: calc(100vh - 80px);
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .uploaded-image { 
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            border: 2px solid #ddd; 
            border-radius: 8px;
            background: white;
            padding: 10px;
          }
          .image-caption { font-size: 16px; color: #666; margin-top: 8px; }
        </style>
      </head>
      <body>
        <!-- PAGE 1: Personal Details -->
        <div class="page">
          <div class="header">
            <div class="gym-logo-header">
              ${logoSrc ? `<img src="${logoSrc}" class="gym-logo" alt="Logo" />` : `<h2>${gymName}</h2>`}
            </div>
          </div>
          <div class="section-title">Personal Details of ${bmiRecord.member.name} :</div>
          <div class="attend-by">Attend By: ${bmiRecord.attendedBy || 'Staff'}</div>
          <table>
            <tbody>
              ${personalRows.map(row => `
                <tr>
                  <td style="font-weight:bold;">${row[0]}</td>
                  <td>${row[1]}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- PAGE 2: BMI Report -->
        <div class="page">
          <div class="header">
            <div class="gym-logo-header">
              ${logoSrc ? `<img src="${logoSrc}" class="gym-logo" alt="Logo" />` : `<h2>${gymName}</h2>`}
            </div>
          </div>
          <div class="section-title">BMI Report of ${bmiRecord.member.name} :</div>
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              ${bmiRows.map(row => `
                <tr>
                  <td>${row[0]}</td>
                  <td>${row[1]}</td>
                  <td>${row[2]}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${bmiRecord.healthConclusion ? `
            <div class="conclusion-title">Health Report Conclusion -</div>
            <div class="conclusion">• "${String(bmiRecord.healthConclusion)}"</div>
          ` : ''}
        </div>

        <!-- PAGE 3: Uploaded Image -->
        <div class="page">
          ${uploadedImageSrc ? `
            <div class="uploaded-image-container">
              <img src="${uploadedImageSrc}" class="uploaded-image" alt="Customer Image" />
            </div>
          ` : `
            <div style="text-align: center; margin: 40px 0; color: #666;">
              <p>No customer image has been uploaded yet.</p>
              <p>Upload an image through the admin panel to see it here.</p>
            </div>
          `}
        </div>

        <!-- PAGE 4: Custom Message -->
        <div class="page">
          <div class="header">
            <div class="gym-logo-header">
              ${logoSrc ? `<img src="${logoSrc}" class="gym-logo" alt="Logo" />` : `<h2>${gymName}</h2>`}
            </div>
          </div>
          <div class="section-title">Check out our gym location & Reviews on the map:</div>
          <div>
            <a class="blue-link" href="https://g.co/kgs/mQtKEQ" target="_blank">${gymName} Link: https://g.co/kgs/mQtKEQ</a>
          </div>
          <div class="custom-msg">
            Experience a personalised tour of our gym and explore our latest offers with one of our trainers. Don't miss out!
          </div>
        </div>
      </body>
    </html>
    `;

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }
    });

    await page.close();
    console.log('PDF generated successfully');
    
    return Buffer.from(pdfBuffer);

  } catch (error) {
    console.error('PDF generation error:', error);
    throw error;
  } finally {
    // Only close browser if we created it (not if it was passed externally)
    if (browser && shouldCloseBrowser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

function getBMIAdvice(category: string): string {
  switch (category) {
    case 'Underweight':
      return '💡 Consider consulting a nutritionist to develop a healthy weight gain plan.';
    case 'Normal Weight':
    case 'Normal':
      return '✅ Great job! Maintain your current lifestyle with regular exercise and balanced diet.';
    case 'Overweight':
      return '⚠️ Consider a structured fitness plan and dietary adjustments to reach optimal health.';
    case 'Obese':
      return '🔴 We recommend immediate consultation with our fitness experts for a personalized plan.';
    default:
      return '📞 Contact our fitness experts for personalized advice.';
  }
}
