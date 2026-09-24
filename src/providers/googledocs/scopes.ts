export const googleDocsReadonlyScope = "https://www.googleapis.com/auth/documents.readonly";
export const googleDocsWriteScope = "https://www.googleapis.com/auth/documents";
export const googleDriveFileScope = "https://www.googleapis.com/auth/drive.file";
export const googleSheetsReadonlyScope = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const googleOpenIdScope = "openid";
export const googleEmailScope = "email";
export const googleProfileScope = "profile";

export const googledocsReadScopes: string[] = [googleDocsReadonlyScope, googleDriveFileScope];
export const googledocsWriteScopes: string[] = [googleDocsWriteScope, googleDriveFileScope];
export const googledocsSheetsReadScopes: string[] = [googleSheetsReadonlyScope, googleDriveFileScope];
export const googledocsOAuthScopes: string[] = [
  googleDocsReadonlyScope,
  googleDocsWriteScope,
  googleDriveFileScope,
  googleSheetsReadonlyScope,
  googleOpenIdScope,
  googleEmailScope,
  googleProfileScope,
];
