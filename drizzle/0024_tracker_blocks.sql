CREATE TABLE "tracker_blocks" (
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_blocks_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "tracker_blocks" ADD CONSTRAINT "tracker_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracker_blocks_user_id_at_index" ON "tracker_blocks" USING btree ("user_id","at");