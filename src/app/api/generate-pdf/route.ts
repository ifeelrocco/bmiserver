import { NextRequest, NextResponse } from 'next/server';
import { generateHealthReportPDF } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import chromium from 'chrome-aws-lambda';
import puppeteer from 'puppeteer-core';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let browser = null;
  
  try {
    console.log('Starting PDF generation API...');
    
    const { bmiRecordId, uploadedImageInfo } = await request.json();

    // Get BMI record
    const { data: bmiRecord, error } = await supabase
      .from('BMIRecord')
      .select(`
        *,
        member:Member(*)
      `)
      .eq('id', parseInt(bmiRecordId))
      .single();

    if (error || !bmiRecord) {
      return NextResponse.json({ error: 'BMI record not found' }, { status: 404 });
    }

    // Launch browser with serverless configuration
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    console.log('Browser launched successfully');

    // Set uploaded image info as environment variable for PDF generation
    if (uploadedImageInfo) {
      process.env.UPLOADED_IMAGE_INFO = JSON.stringify(uploadedImageInfo);
    }

    // Generate PDF with browser instance
    const pdfBuffer = await generateHealthReportPDF(bmiRecord, true, browser);

    // Clear the environment variable
    delete process.env.UPLOADED_IMAGE_INFO;

    console.log('PDF generated successfully');

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${bmiRecord.member.name.replace(/\s+/g, '-')}-Health-Report.pdf"`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ 
      error: 'PDF generation failed',
      details: error.message 
    }, { status: 500 });
  } finally {
    // Always close browser to prevent memory leaks
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}
