import { NextApiRequest, NextApiResponse } from "next";
// @ts-ignore
import mupdf from "mupdf";
import prisma from "@/lib/prisma";
import { putFileServer } from "@/lib/files/put-file-server";
import { log } from "@/lib/utils";

// This function can run for a maximum of 60 seconds
export const config = {
  maxDuration: 120,
  memory: 2048,
};

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // check if post method
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Extract the API Key from the Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Assuming the format is "Bearer [token]"

  // Check if the API Key matches
  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { documentVersionId, pageNumber, url, teamId } = req.body as {
    documentVersionId: string;
    pageNumber: number;
    url: string;
    teamId: string;
  };

  try {
    // Fetch the PDF data
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      log({
        message: `Failed to fetch PDF in conversion process with error: \n\n Error: ${error} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
        type: "error",
        mention: true,
      });
      throw new Error(`Failed to fetch pdf on document page ${pageNumber}`);
    }

    // Convert the response to an ArrayBuffer
    const pdfData = await response.arrayBuffer();
    // Create a MuPDF instance
    var doc = mupdf.Document.openDocument(pdfData, "application/pdf");

    var page = doc.loadPage(pageNumber - 1); // 0-based page index

    // get links
    const links = page.getLinks();
    const embeddedLinks = links.map((link: any) => link.getURI());

    var pixmap = page.toPixmap(
      // mupdf.Matrix.identity,
      [3, 0, 0, 3, 0, 0], // scale 3x // to 300 DPI
      mupdf.ColorSpace.DeviceRGB,
    );

    pixmap.setResolution(300, 300); // increase resolution to 300 DPI

    var pngBuffer = pixmap.asPNG(); // as PNG

    const buffer = Buffer.from(pngBuffer);

    // get docId from url with starts with "doc_" with regex
    const match = url.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    const { type, data } = await putFileServer({
      file: {
        name: `page-${pageNumber}.png`,
        type: "image/png",
        buffer: buffer,
      },
      teamId: teamId,
      docId: docId,
    });

    if (!data || !type) {
      throw new Error(`Failed to upload document page ${pageNumber}`);
    }

    const documentPage = await prisma.documentPage.create({
      data: {
        versionId: documentVersionId,
        pageNumber: pageNumber,
        file: data,
        storageType: type,
        embeddedLinks: embeddedLinks,
      },
    });

    if (!documentPage) {
      res.status(500).json({ error: "Failed to create document page" });
      return;
    }

    // Send the images as a response
    res.status(200).json({ documentPageId: documentPage.id });
    return;
  } catch (error) {
    log({
      message: `Failed to convert page with error: \n\n Error: ${error} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
      type: "error",
      mention: true,
    });
    throw error;
  }
};
