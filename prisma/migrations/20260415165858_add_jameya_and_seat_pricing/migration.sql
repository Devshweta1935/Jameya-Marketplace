/*
  Warnings:

  - Added the required column `price` to the `seats` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seat_number` to the `seats` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "seats" ADD COLUMN     "price" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "seat_number" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "jameyas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_amount" DECIMAL(12,2) NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jameyas_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_jameya_id_fkey" FOREIGN KEY ("jameya_id") REFERENCES "jameyas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
