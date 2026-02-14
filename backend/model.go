package main

type TopicsResponse struct {
	Topics []Topic `json:"topics"`
} // @name Topics

type Topic struct {
	TopicID      uint   `json:"topic_id"`
	ForumID      uint   `json:"forum_id"`
	Title        string `json:"title"`
	Views        int    `json:"total_views"`
	Replies      int    `json:"total_replies"`
	WebPath      string `json:"web_path"`
	PostTime     string `json:"post_time"`
	LastPostTime string `json:"last_post_time"`
	Votes        Votes
	Offer        Offer
	Score        int `json:"score"`
} // @name Topic

type Votes struct {
	Up   int `json:"total_up"`
	Down int `json:"total_down"`
} // @name Votes

type Offer struct {
	DealerName string `json:"dealer_name"`
	Url string `json:"url"`
} // @name Offer

type TopicDetails struct {
	Topic       Topic  `json:"topic"`
	Description string `json:"description"`
	FirstPost   string `json:"first_post"`
} // @name TopicDetails
