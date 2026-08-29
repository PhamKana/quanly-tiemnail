import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { firebaseAppletConfigPath } from '../src/config/paths';

async function runMigration() {
  console.log('Starting commission rate migration...');
  
  // Load configuration from firebase-applet-config.json
  const appletConfig = JSON.parse(fs.readFileSync(firebaseAppletConfigPath, 'utf-8'));
  
  let app;
  if (getApps().length === 0) {
    app = initializeApp({
      projectId: appletConfig.projectId
    });
  } else {
    app = getApp();
  }
  
  // Use firestoreDatabaseId if specified, or default
  const db = appletConfig.firestoreDatabaseId 
    ? getFirestore(app, appletConfig.firestoreDatabaseId)
    : getFirestore(app);
  
  // 1. Fetch all staff to create a map of staffId -> current commissionRate
  console.log('Fetching staff members...');
  const staffSnap = await db.collection('staff').get();
  const staffRates = new Map<string, number>();
  staffSnap.forEach(doc => {
    const data = doc.data();
    if (data && data.commissionRate !== undefined) {
      staffRates.set(doc.id, data.commissionRate);
    }
  });
  console.log(`Loaded ${staffRates.size} staff members.`);
  
  // 2. Fetch all staff_income records to build a map of appointmentId -> commissionRate
  console.log('Fetching staff_income records for precise historical rates...');
  const incomeSnap = await db.collection('staff_income').get();
  const historicalRates = new Map<string, number>();
  incomeSnap.forEach(doc => {
    const data = doc.data();
    if (data && data.appointmentId && data.commissionRate !== undefined) {
      historicalRates.set(data.appointmentId, data.commissionRate);
    }
  });
  console.log(`Loaded ${historicalRates.size} staff_income records.`);
  
  // 3. Fetch all completed appointments
  console.log('Fetching completed appointments...');
  const apptsSnap = await db.collection('appointments')
    .where('status', '==', 'completed')
    .get();
    
  console.log(`Found ${apptsSnap.size} completed appointments.`);
  
  let migratedCount = 0;
  let skippedCount = 0;
  
  // We can write updates in batches (limit of 500 operations per batch in Firestore)
  let batch = db.batch();
  let batchSize = 0;
  
  for (const doc of apptsSnap.docs) {
    const appt = doc.data();
    
    // Skip if commissionRate is already set
    if (appt.commissionRate !== undefined) {
      skippedCount++;
      continue;
    }
    
    // Find the commission rate to use
    let rateToUse = historicalRates.get(doc.id);
    let source = 'staff_income';
    
    if (rateToUse === undefined) {
      // Fallback to current staff rate
      rateToUse = staffRates.get(appt.staffId);
      source = 'current staff rate';
    }
    
    if (rateToUse !== undefined) {
      batch.update(doc.ref, {
        commissionRate: rateToUse,
        updatedAt: new Date().toISOString()
      });
      migratedCount++;
      batchSize++;
      
      console.log(`Appointment ${doc.id}: Migrating commissionRate to ${rateToUse} (Source: ${source})`);
      
      if (batchSize >= 500) {
        console.log('Committing batch of 500 updates...');
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    } else {
      console.warn(`Appointment ${doc.id}: No commission rate found for staff ${appt.staffId}`);
    }
  }
  
  if (batchSize > 0) {
    console.log(`Committing final batch of ${batchSize} updates...`);
    await batch.commit();
  }
  
  console.log('Migration completed successfully.');
  console.log(`- Total Completed Appointments: ${apptsSnap.size}`);
  console.log(`- Migrated (commissionRate set): ${migratedCount}`);
  console.log(`- Skipped (already had commissionRate): ${skippedCount}`);
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
